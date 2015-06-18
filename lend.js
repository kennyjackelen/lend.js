/*jshint node:true */
'use strict';

var request = require('request');
var Q = require('q');
var bunyan = require('bunyan');
var nconf = require('nconf');

// Load configuration from files
nconf.file('custom', './config.json');
nconf.file('default', './default.json');
var config = nconf.get();

// Secret configuration
var API_KEY = process.env.LENDINGCLUB_API_KEY;
var THIRD_PARTY_KEY = process.env.LENDINGCLUB_THIRD_PARTY_KEY;
var MY_ACCOUNT_ID = process.env.LENDINGCLUB_ACCOUNT_ID;
var PORTFOLIO_ID = process.env.LENDINGCLUB_PORTFOLIO_ID;

// Error logging
var log = bunyan.createLogger({
            name: 'lend.js',
            streams: [{
              type: 'rotating-file',
              path: config.ERROR_LOG_FILE,
              period: '1d'   // daily rotation
            }]
          });

// Important to call this between requests since Lending Club
// only allows one request per second.
function throttle() {
  var deferred = Q.defer();
  var argsToPassAlong = arguments;
  setTimeout( function() { deferred.resolve.apply( this, argsToPassAlong ); }, config.THROTTLE_LENGTH );
  return deferred.promise;
}

// Calls Lending Club's API to get all available listings
function getAvailableListings() {
  var deferred = Q.defer();
  var lendingData = {};

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + config.API_VERS + '/loans/listing?showAll=true',
    headers: {
      Authorization: API_KEY,
      'X-LC-Application-Key': THIRD_PARTY_KEY,
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
      deferred.reject( new Error( 'getAvailableListings: status code ' + response.statusCode ) );
      return;
    }
    lendingData.listings = JSON.parse( body ).loans;
    deferred.resolve( lendingData );
  }
}

// Calls Lending Club's API to get your account balance
function getMyAccountBalance( lendingData ) {
  var deferred = Q.defer();

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + config.API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/availablecash',
    headers: {
      Authorization: API_KEY,
      'X-LC-Application-Key': THIRD_PARTY_KEY,
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
      deferred.reject( new Error( 'getMyAccountBalance: status code ' + response.statusCode ) );
      return;
    }
    lendingData.balance = JSON.parse( body ).availableCash;
    deferred.resolve( lendingData );
  }
}

// Calls Lending Club's API to get the list of loans you've
// already invested in
function getMyLoans( lendingData ) {
  var deferred = Q.defer();

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + config.API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/notes',
    headers: {
      Authorization: API_KEY,
      'X-LC-Application-Key': THIRD_PARTY_KEY,
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
      deferred.reject( new Error( 'gotLoans: status code ' + response.statusCode ) );
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

// Filters out loans that don't meet your conditions
function filterListings( lendingData ) {
  var deferred = Q.defer();
  var loanCount = Math.floor( lendingData.balance / config.LOAN_AMOUNT );
  lendingData.filteredListings = lendingData.listings.filter( filterOneListing );
  lendingData.filteredListings.sort( sortListings );
  lendingData.loansToOrder = lendingData.filteredListings.slice( 0, loanCount );
  console.log( lendingData.loansToOrder );

  deferred.resolve( lendingData );
  return deferred.promise;

  function filterOneListing( listing ) {
    var filters = config.FILTERS;
    if ( lendingData.alreadyInvested[ listing.id ] ) {
      return false;
    }
    if ( filters.EXCLUDE_STATES.lastIndexOf( listing.addrState ) > -1 ) {
      return false;
    }
    if ( filters.EXCLUDE_60_MO_LOANS && ( listing.term === 60 ) ) {
      return false;
    }
    if ( filters.EXCLUDE_GRADES.lastIndexOf( listing.grade ) > -1 ) {
      return false;
    }
    if ( listing.empLength < filters.MIN_MONTHS_EMPLOYED ) {
      return false;
    }
    if ( listing.inqLast6Mths > filters.MAX_INQUIRIES_LAST_6_MONTHS ) {
      return false;
    }
    if ( ( filters.INCLUDE_LOAN_PURPOSES.length > 0 ) && ( filters.INCLUDE_LOAN_PURPOSES.lastIndexOf( listing.purpose ) === -1 ) )  {
      return false;
    }
    if ( filters.EXCLUDE_PUBLIC_RECORDS && ( listing.pubRec > 0 ) ) {
      return false;
    }
    if ( listing.delinq2Yrs > filters.MAX_DELINQUENCIES_LAST_2_YEARS ) {
      return false;
    }
    if ( ( listing.openAcc > filters.MAX_OPEN_CREDIT_LINES ) || ( listing.openAcc < filters.MIN_OPEN_CREDIT_LINES ) ) {
      return false;
    }
    if ( filters.REQUIRE_REVOLVING_BALANCE_LESS_THAN_LOAN_AMOUNT && ( listing.revolBal < listing.loanAmount ) ) {
      return false;
    }
    return true;
  }

  function sortListings( a, b ) {
    return b.intRate - a.intRate;
  }
}

// Calls Lending Club's API to order the loans that met your
// criteria. It will order as many loans as you can afford,
// prioritizing high yielding loans over lower yielding loans.
function placeOrder( lendingData ) {
  var deferred = Q.defer();
  var payload = {
    aid: MY_ACCOUNT_ID,
    orders: []
  };

  if ( !config.PLACE_ORDERS ) {
    deferred.resolve();
    return deferred.promise;
  }

  for ( var i = 0; i < lendingData.loansToOrder.length; i++ ) {
    var loan = lendingData.loansToOrder[ i ];
    payload.orders.push( { loanId: loan.id, requestedAmount: config.LOAN_AMOUNT, portfolioId: PORTFOLIO_ID } );
  }

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + config.API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/orders',
    method: 'POST',
    headers: {
      Authorization: API_KEY,
      'X-LC-Application-Key': THIRD_PARTY_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify( payload )
  };

  if ( payload.orders.length > 0 ) {
    request(options, orderPlaced);
  }
  else {
    log.info( 'Finished successfully: no loans ordered' );
    deferred.resolve();
  }

  return deferred.promise;

  function orderPlaced( err, response ) {
    if ( err ) {
      deferred.reject( new Error( 'placeOrder: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( new Error( 'placeOrder: status code ' + response.statusCode ) );
      return;
    }
    log.info( 'Finished successfully: ' + payload.orders.length + ' loans ordered' );
    deferred.resolve();
  }
}

// Logs errors to the screen and to file.
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
