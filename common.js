/*jshint node:true */
'use strict';

var request = require('request');
var Q = require('q');

module.exports = function initCommon( config, MY_ACCOUNT_ID, API_KEY, THIRD_PARTY_KEY ) {

  // Error logging
  var log = bunyan.createLogger({
              name: 'lend.js',
              streams: [{
                type: 'rotating-file',
                path: config.ERROR_LOG_FILE,
                period: '1d'   // daily rotation
              }]
            });

  return {
    
    logError: function logError( error ) {
      log.error( error );
    },

    logInfo: function logInfo( info, title ) {
      log.info( info, title );
    },

    // Calls Lending Club's API to get your account balance
    getMyAccountBalance: function getMyAccountBalance( lendingData ) {
      var deferred = Q.defer();
      lendingData = lendingData || {};

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
    },

    // Important to call this between requests since Lending Club
    // only allows one request per second.
    throttle: function throttle() {
      var deferred = Q.defer();
      var argsToPassAlong = arguments;
      setTimeout( function() { deferred.resolve.apply( this, argsToPassAlong ); }, config.THROTTLE_LENGTH );
      return deferred.promise;
    }
  }

};
