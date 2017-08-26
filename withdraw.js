/*jshint node:true */
'use strict';

/*

Great occasions do not make heroes or cowards;
They simply unveil them to the eyes of men.

*/

var request = require('request');
var Q = require('q');
var nconf = require('nconf');

// Load configuration from files
var CONFIG_FILE = process.env.LENDJS_CONFIG_FILE;
if ( CONFIG_FILE ) {
  nconf.file('env', CONFIG_FILE );
}
nconf.file('custom', './config.json');
nconf.file('default', './default.json');
var config = nconf.get();

// Secret configuration
var API_KEY = process.env.LENDINGCLUB_API_KEY;
var THIRD_PARTY_KEY = process.env.LENDINGCLUB_THIRD_PARTY_KEY;
var MY_ACCOUNT_ID = process.env.LENDINGCLUB_ACCOUNT_ID;

var common = require('./common')( config, MY_ACCOUNT_ID, API_KEY, THIRD_PARTY_KEY );

function withdraw( lendingData ) {
  var deferred = Q.defer();
  var payload = {
    amount : lendingData.balance
  }

  if ( !config.WITHDRAW_FUNDS ) {
    deferred.resolve();
    return deferred.promise;
  }

  var options = {
    url: 'https://api.lendingclub.com/api/investor/' + config.API_VERS + '/accounts/' + MY_ACCOUNT_ID + '/funds/withdraw',
    method: 'POST',
    headers: {
      Authorization: API_KEY,
      'X-LC-Application-Key': THIRD_PARTY_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify( payload )
  };

  if ( lendingData.balance > config.MIN_WITHDRAWAL ) {
    request( options, withdrawalPlaced );
  }
  else {
    logSuccess( lendingData );
    deferred.resolve();
  }

  return deferred.promise;

  function withdrawalPlaced( err, response ) {
    if ( err ) {
      deferred.reject( new Error( 'withdraw: ' + err ) );
      return;
    }
    if ( response.statusCode !== 200 ) {
      deferred.reject( new Error( 'withdraw: status code ' + response.statusCode ) );
      return;
    }
    logSuccess( lendingData );
    deferred.resolve();
  }
}

// Logs errors to the screen and to file.
function errorHandler( error ) {
  console.log( error );
  common.logError( error );
}

// Logs a success message and details to file.
function logSuccess( lendingData ) {
  var output = {
    availableCash: lendingData.balance
  };
  common.logInfo( output, 'Withdrawal finished successfully.' );
}

common.getMyAccountBalance()
  .then( common.throttle )
  .then( withdraw )
  .catch( errorHandler );
