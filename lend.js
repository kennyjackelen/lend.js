/*jshint node:true */
'use strict';

var request = require('request');
var Q = require('q');
var bunyan = require('bunyan');

// Secret configuration
var MY_KEY = process.env.LENDINGCLUB_API_KEY;
var MY_ACCOUNT_ID = process.env.LENDINGCLUB_ACCOUNT_ID;
var PORTFOLIO_ID = process.env.LENDINGCLUB_PORTFOLIO_ID;

// Configuration
var PLACE_ORDERS = true;
var API_VERS = 'v1';
var LOAN_AMOUNT = 25;
var THROTTLE_LENGTH = 1000;  // ms

// Error logging
var ERROR_LOG_FILE = 'log/error.log';
var log = bunyan.createLogger({
            name: 'lend.js',
            streams: [{
              path: ERROR_LOG_FILE
            }]
          });

// Filters
var EXCLUDE_STATES = [ 'CA', 'FL', 'NV' ];
var EXCLUDE_60_MO_LOANS = true;
var EXCLUDE_GRADES = [ 'A', 'B', 'C' ];
var MIN_MONTHS_EMPLOYED = 24;
var MAX_INQUIRIES_LAST_6_MONTHS = 2;
var INCLUDE_LOAN_PURPOSES = [ 'credit_card', 'debt_consolidation' ];  // Total list of purposes: 'credit_card', 'debt_consolidation', 'medical', 'educational', 'home_improvement', 'renewable_energy', 'small_business', 'wedding', 'vacation', 'moving', 'house', 'car', 'major_purchase', 'other'
var EXCLUDE_PUBLIC_RECORDS = true;
var MAX_DELINQUENCIES_LAST_2_YEARS = 0;
var MIN_OPEN_CREDIT_LINES = 2;
var MAX_OPEN_CREDIT_LINES = 19;
var REQUIRE_REVOLVING_BALANCE_LESS_THAN_LOAN_AMOUNT = true;

function throttle() {
  var deferred = Q.defer();
  var argsToPassAlong = arguments;
  setTimeout( function() { deferred.resolve.apply( this, argsToPassAlong ); }, THROTTLE_LENGTH );
  return deferred.promise;
}

function getAvailableListings() {
  var deferred = Q.defer();
  var lendingData = {};

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + API_VERS + '/loans/listing?showAll=true',
    headers: {
      Authorization: MY_KEY,
      Accept: 'application/json'
    }
  };

  request( options, gotListings );

  return deferred.promise;

  function gotListings( err, response, body ) {
    if ( err ) {
      deferred.reject( new Error( 'getAvailableListings: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( 'getAvailableListings: status code ' + response.statusCode );
      return;
    }
    lendingData.listings = JSON.parse( body ).loans;
    deferred.resolve( lendingData );
  }
}

function getMyAccountBalance( lendingData ) {
  var deferred = Q.defer();

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/availablecash',
    headers: {
      Authorization: MY_KEY,
      Accept: 'application/json'
    }
  };

  request( options, gotResponse );

  return deferred.promise;

  function gotResponse( err, response, body ) {
    if ( err ) {
      deferred.reject( new Error( 'getMyAccountBalance: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( 'getMyAccountBalance: status code ' + response.statusCode );
      return;
    }
    lendingData.balance = JSON.parse( body ).availableCash;
    deferred.resolve( lendingData );
  }
}

function getMyLoans( lendingData ) {
  var deferred = Q.defer();

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/notes',
    headers: {
      Authorization: MY_KEY,
      Accept: 'application/json'
    }
  };

  request( options, gotLoans );

  return deferred.promise;

  function gotLoans( err, response, body ) {
    if ( err ) {
      deferred.reject( new Error( 'gotLoans: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( 'gotLoans: status code ' + response.statusCode );
      return;
    }
    var loans = JSON.parse( body ).myNotes;
    lendingData.alreadyInvested = {};
    for ( var i = 0; i < loans.length; i++ ) {
      var loan = loans[ i ];
      lendingData.alreadyInvested[ loan.loanId ] = true;
    }
    deferred.resolve( lendingData );
  }
}

function filterListings( lendingData ) {
  var deferred = Q.defer();
  var loanCount = Math.floor( lendingData.balance / LOAN_AMOUNT );
  lendingData.filteredListings = lendingData.listings.filter( filterOneListing );
  lendingData.filteredListings.sort( sortListings );
  lendingData.loansToOrder = lendingData.filteredListings.slice( 0, loanCount );
  console.log( lendingData.loansToOrder );

  deferred.resolve( lendingData );
  return deferred.promise;

  function filterOneListing( listing ) {
    if ( lendingData.alreadyInvested[ listing.id ] ) {
      return false;
    }
    if ( EXCLUDE_STATES.lastIndexOf( listing.addrState ) > -1 ) {
      return false;
    }
    if ( EXCLUDE_60_MO_LOANS && ( listing.term === 60 ) ) {
      return false;
    }
    if ( EXCLUDE_GRADES.lastIndexOf( listing.grade ) > -1 ) {
      return false;
    }
    if ( listing.empLength < MIN_MONTHS_EMPLOYED ) {
      return false;
    }
    if ( listing.inqLast6Mths > MAX_INQUIRIES_LAST_6_MONTHS ) {
      return false;
    }
    if ( ( INCLUDE_LOAN_PURPOSES.length > 0 ) && ( INCLUDE_LOAN_PURPOSES.lastIndexOf( listing.purpose ) === -1 ) )  {
      return false;
    }
    if ( EXCLUDE_PUBLIC_RECORDS && ( listing.pubRec > 0 ) ) {
      return false;
    }
    if ( listing.delinq2Yrs > MAX_DELINQUENCIES_LAST_2_YEARS ) {
      return false;
    }
    if ( ( listing.openAcc > MAX_OPEN_CREDIT_LINES ) || ( listing.openAcc < MIN_OPEN_CREDIT_LINES ) ) {
      return false;
    }
    if ( REQUIRE_REVOLVING_BALANCE_LESS_THAN_LOAN_AMOUNT && ( listing.revolBal < listing.loanAmount ) ) {
      return false;
    }
    return true;
  }

  function sortListings( a, b ) {
    return b.intRate - a.intRate;
  }
}

function placeOrder( lendingData ) {
  var deferred = Q.defer();
  var payload = {
    aid: MY_ACCOUNT_ID,
    orders: []
  };

  if ( !PLACE_ORDERS ) {
    deferred.resolve();
    return deferred.promise;
  }

  for ( var i = 0; i < lendingData.loansToOrder.length; i++ ) {
    var loan = lendingData.loansToOrder[ i ];
    payload.orders.push( { loanId: loan.id, requestedAmount: LOAN_AMOUNT, portfolioId: PORTFOLIO_ID } );
  }

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/orders',
    method: 'POST',
    headers: {
      Authorization: MY_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify( payload )
  };

  if ( payload.orders.length > 0 ) {
    request(options, orderPlaced);
  }
  else {
    deferred.resolve();
  }

  return deferred.promise;

  function orderPlaced( err, response, body ) {
    if ( err ) {
      deferred.reject( new Error( 'placeOrder: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( 'placeOrder: status code ' + response.statusCode );
      return;
    }
    deferred.resolve();
  }
}

function errorHandler( error ) {
  console.log( error );
  log.error( error );
}

getAvailableListings()
  .then( throttle )
  .then( getMyAccountBalance )
  .then( throttle )
  .then( getMyLoans )
  .then( throttle )
  .then( filterListings )
  .then( placeOrder )
  .catch( errorHandler );
