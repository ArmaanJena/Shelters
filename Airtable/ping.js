// netlify/functions/ping.js

exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    body: 'pong',
  };
};