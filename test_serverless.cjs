const serverless = require('serverless-http');
const express = require('express');
const app = express();
app.get('/api/test', (req, res) => res.json({ url: req.url, path: req.path, originalUrl: req.originalUrl }));
const handler = serverless(app);
handler({ path: '/api/test', httpMethod: 'GET', requestContext: {} }).then(console.log);
handler({ path: '/.netlify/functions/api/test', httpMethod: 'GET', requestContext: {} }).then(console.log);
