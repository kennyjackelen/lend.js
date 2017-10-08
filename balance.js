/*jshint node:true */
'use strict';

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
var MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
var MAILGUN_DOMAIN_NAME = process.env.MAILGUN_DOMAIN_NAME;
var MAILGUN_FROM = process.env.MAILGUN_FROM;
var MAILGUN_TAG = process.env.MAILGUN_TAG;

var common = require('./common')( config, MY_ACCOUNT_ID, API_KEY, THIRD_PARTY_KEY );
var mailer = require('./mail')( config, MAILGUN_API_KEY, MAILGUN_DOMAIN_NAME, MAILGUN_FROM, MAILGUN_TAG );

function notify( lendingData ) {
  if ( lendingData.balance >= config.NOTIFY_MIN_BALANCE ) {
    return mailer.send(
      'LendingClub Balance Notification',
      'You have $' + lendingData.balance + ' in your LendingClub account.'
    );  // returns a promise
  }
  else {
    return Q.resolve();
  }
}

// Logs errors to the screen and to file.
function errorHandler( error ) {
  if ( error ) {
    console.log( error );
    common.logError( error );
  }
}

// Logs a success message and details to file.
function logSuccess( lendingData ) {
  var output = {
    availableCash: lendingData.balance
  };
  common.logInfo( output, 'Balance notify finished successfully.' );
}

mailer.shouldSendEmail()
  .then( common.getMyAccountBalance )
  .then( common.throttle )
  .then( notify )
  .catch( errorHandler );
