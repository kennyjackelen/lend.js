var Q = require('q');

module.exports = function initMailer( config, MAILGUN_API_KEY, MAILGUN_DOMAIN_NAME, MAILGUN_FROM, MAILGUN_TAG ) {

  var mailgun = require('mailgun-js')( { apiKey: MAILGUN_API_KEY, domain: MAILGUN_DOMAIN_NAME } );

  if ( !config.SEND_EMAIL_TO ) {
    throw new Error('Destination email address missing from config file!');
  }
  if ( !MAILGUN_TAG ) {
    throw new Error('Mailgun tag not supplied!');
  }
  if ( !MAILGUN_API_KEY ) {
    throw new Error('Mailgun API key not supplied!');
  }
  if ( !MAILGUN_DOMAIN_NAME ) {
    throw new Error('Mailgun domain name not supplied!');
  }
  if ( !MAILGUN_FROM ) {
    throw new Error('Sending email address not supplied!');
  }

  return {
    send : function( subject, text ) {
      var deferred = Q.defer();

      var data = {
        from: MAILGUN_FROM,
        to: config.SEND_EMAIL_TO,
        subject: subject,
        text: text,
        'o:tag': MAILGUN_TAG
      }
      
      mailgun.messages().send( data, gotResponse );

      return deferred.promise;

      function gotResponse( error, body ) {
        if ( error ) {
          deferred.reject( new Error( error ) );
          return;
        }
        deferred.resolve( body );
      }
    },
    shouldSendEmail : function() {
      var deferred = Q.defer();

      var data = {
        event: 'delivered',
        to: config.SEND_EMAIL_TO,
        ascending: "no",
        limit: 1,
        tags: MAILGUN_TAG
      };

      mailgun.get('/' + MAILGUN_DOMAIN_NAME + '/events', data, gotResponse);
      
      return deferred.promise;

      function gotResponse(error, body) {
        if ( error ) {
          deferred.reject( new Error( error ) );
          return;
        }
        if ( body.items.length > 0 ) {
          var d = new Date(0);
          d.setUTCSeconds( body.items[0].timestamp );
          console.log( d );
          if ( ( new Date() - d ) / ( 60 * 60 * 1000 ) < config.MIN_HOURS_BETWEEN_NOTIFICATIONS ) {
            deferred.reject();  // last message was sent too recently
            return;
          }
          deferred.resolve();  // last message was sent long enough ago
          return;
        }
        deferred.resolve();  // no last message found
      }
    }
  };

};