
var Webpack = require('webpack');

module.exports = {
  entry: './src/js/main.js',
  output: {
    path: __dirname + '/public/',
    filename: 'bundle.js'
  },
  module: {
    loaders: [{
      test: /\.js$/,
      loader: 'babel',
      exclude: [/node_modules/, /bower_components/]
    },
    {
      test: /\.scss$/,
      loader: 'style!css!sass?sourceMap'
    }]
  },
  plugins: [
  /*  new Webpack.optimize.UglifyJsPlugin({
      compress:true      
    })*/
  ]
};