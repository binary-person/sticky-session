'use strict';

var cluster = require('cluster');
var util = require('util');
var net = require('net');
var ip = require('ip');
var HTTPParser = require('http-parser-js').HTTPParser;

var debug = require('debug')('sticky:master');

/**
 * @typedef {object} MasterOptions
 * @property {null | string} proxyHeader
 * @property {null | (socket: net.Socket, req: import('http-parser-js').HeaderInfo) => number[]} generatePrehashArray
 */

/**
 * @param {MasterOptions} options
 */
function Master(options) {
  debug('master options=%j', options);

  if (!options) {
    options = {};
  }

  if (options.generatePrehashArray && options.proxyHeader) {
    throw new TypeError('cannot specify generatePrehashArray and proxyHeader options together');
  }
  if (!options.generatePrehashArray && options.proxyHeader) {
    options.generatePrehashArray = function (socket, req) {
      var address = socket.remoteAddress || '';

      for (var i = 0; i < req.headers.length; i += 2) {
        if (req.headers[i].toLowerCase() === options.proxyHeader) {
          address = (req.headers[i + 1] || '').trim().split(' ').shift() || address;
          break;
        }
      }
      debug('Proxy Address %j', address);

      return ip.toBuffer(address);
    };
  }

  var balanceFunc;
  if (options.generatePrehashArray)
    balanceFunc = this.balanceProxyAddress;
  else
    balanceFunc = this.balanceRemoteAddress;

  net.Server.call(this, {
    pauseOnConnect: true
  }, balanceFunc);

  this.options = options;
  this.seed = (Math.random() * 0xffffffff) | 0;
  this.workers = [];

  debug('master seed=%d', this.seed);

  for (var i = 0; i < options.workers; i++)
    this.spawnWorker();

  this.once('listening', function () {
    debug('master listening on %j', this.address());
  });
}
util.inherits(Master, net.Server);
module.exports = Master;

Master.prototype.hash = function hash(data) {
  var hash = this.seed;
  for (var i = 0; i < data.length; i++) {
    var num = data[i];

    hash += num;
    hash %= 2147483648;
    hash += (hash << 10);
    hash %= 2147483648;
    hash ^= hash >> 6;
  }

  hash += hash << 3;
  hash %= 2147483648;
  hash ^= hash >> 11;
  hash += hash << 15;
  hash %= 2147483648;

  return hash >>> 0;
};

Master.prototype.spawnWorker = function spawnWorker() {
  var worker = cluster.fork();

  var self = this;
  worker.on('exit', function (code) {
    debug('worker=%d died with code=%d', worker.process.pid, code);
    self.respawn(worker);
  });

  debug('worker=%d spawn', worker.process.pid);
  this.workers.push(worker);
};

Master.prototype.respawn = function respawn(worker) {
  var index = this.workers.indexOf(worker);
  if (index !== -1)
    this.workers.splice(index, 1);
  this.spawnWorker();
};

Master.prototype.balanceRemoteAddress = function balance(socket) {
  var addr = ip.toBuffer(socket.remoteAddress || '127.0.0.1');
  var hash = this.hash(addr);

  debug('balancing connection %j', addr);
  this.workers[hash % this.workers.length].send(['sticky:balance'], socket);
};

Master.prototype.balanceProxyAddress = function balance(socket) {
  var self = this;
  debug('incoming proxy');
  socket.resume();

  var parser = new HTTPParser('REQUEST');
  parser.reinitialize(HTTPParser.REQUEST);

  var receivedChunks = [];

  function handler(buffer) {
    receivedChunks.push(buffer);
    parser.execute(buffer, 0, buffer.length);
  }
  socket.on('data', handler);

  parser.onHeadersComplete = function (req) {
    parser.finish();
    socket.pause();

    var prehashArray = self.options.generatePrehashArray(socket, req);
    debug('got prehash array: %j', prehashArray);
  
    var workerId = self.hash(prehashArray) % self.workers.length;
    debug('sending to worker %d', self.workers[workerId].process.pid);

    // Pass connection to worker
    // Pack the request with the message
    self.workers[workerId].send(['sticky:balance', Buffer.concat(receivedChunks).toString('base64')], socket);
  };
};
