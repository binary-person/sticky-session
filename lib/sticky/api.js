'use strict';

var cluster = require('cluster');
var debug = require('debug')('sticky:worker');

var Master = require('./master');

/**
 * @param {import('http').Server} server
 * @param {number} port
 * @param {string?} hostname
 * @param {import('./master').MasterOptions?} options
 * @returns {null | (callback: () => void, waitForConnections?: boolean) => void} - close handle
 */
function listen(server, port, hostname, options) {
  if (!options)
    options = {};

  if (cluster.isMaster) {
    var master = new Master(options);
    master.listen(port, hostname);
    master.once('listening', function () {
      server.emit('listening');
    });
    return master.close.bind(master);
  }

  process.on('message', function (msg, socket) {
    if (!msg.length)
      return;
    if (msg[0] === 'sticky:close') {
      debug('received exit request from master process');
      if (process._events.SIGINT) {
        debug('SIGINT listener exists. calling process.emit(\'SIGINT\')');
        process.emit('SIGINT');
      } else {
        debug('SIGINT listener does not exit. calling process.exit()');
        process.exit();
      }
      return;
    }
    if (msg[0] !== 'sticky:balance' || !socket)
      return;

    debug('incoming socket');
    server._connections++;
    socket.server = server;

    // reappend the buffer
    if (msg[1]) {
      socket.unshift(Buffer.from(msg[1], 'base64'));
    }

    server.emit('connection', socket);
    socket.resume();
  });

  return null;
}
exports.listen = listen;
