const path = require('node:path');

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ['function-call-key-plugin'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};
