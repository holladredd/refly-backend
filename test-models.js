import https from 'https';

const options = {
  hostname: 'api.x.ai',
  port: 443,
  path: '/v1/models',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer xai-AgAqLVw05pZjWsazlJhW1PnX6qa8dqRzDVXfj7XLjqtbOJSfdYhq01fyfLTz5ksFzInwtlHcgLSJ4ydv'
  }
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
});

req.on('error', error => {
  console.error(error);
});

req.end();
