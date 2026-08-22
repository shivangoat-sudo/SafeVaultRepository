const express = require('express');
const app = express();
app.use((req, res, next) => {
  if (req.url.startsWith('/.netlify/functions/api/')) {
    req.url = req.url.replace('/.netlify/functions/api/', '/api/');
  }
  next();
});
app.get('/api/test', (req, res) => res.json({ success: true, url: req.url }));
const request = require('supertest');
request(app).get('/.netlify/functions/api/test').expect(200).then(res => console.log(res.body)).catch(console.error);
