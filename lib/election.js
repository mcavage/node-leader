// Copyright 2012 Mark Cavage.  All rights reserved.
//
// Provides a leader election "class" using ZooKeeper
//

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var ZooKeeper = require('zookeeper');



// --- Globals

var ZNODE_FLAGS = ZooKeeper.ZOO_SEQUENCE | ZooKeeper.ZOO_EPHEMERAL;



// --- Internal Functions

// An Error object to wrap up ZooKeeper's return codes.
// TODO: Turn numeric code into something meaningful
function ZooKeeperError(code, message, constructorOpt) {
	if (Error.captureStackTrace)
		Error.captureStackTrace(this, constructorOpt || ZooKeeperError);

	this.name = 'ZooKeeperError';
	this.message = message || '';
	this.code = code;

}
ZooKeeperError.prototype = new Error();
ZooKeeperError.prototype.constructor = ZooKeeperError;


function isLeader(znode, children) {
	assert.equal(typeof(znode), 'string');
	assert.ok(Array.isArray(children));

	return children.indexOf(znode.split('/').pop()) === 0;
}


function getParent(znode, children) {
	var index = children.indexOf(znode.split('/').pop());
	return children[index - 1];
}


function reelect(node) {
	assert.equal(typeof(node), 'object');

	var log = node.log;
	return function(type, state, path) {
		log.trace('ZK event: t=%d, s=%d, p=%s', type, state, path);
		if (type !== ZooKeeper.ZOO_DELETED_EVENT) {
			log.trace('ZK event: NO-OP');
			return false;
		}

		// If we're here, that means our immediate parent went away,
		// and so we have to go into the reelection process (which
		// really means see if we're the lowest sequence number).

		log.debug('running reelection...');
		return node.list(function(err, children) {
			if (err)
				return node.emit('error', err);

			if ((node._leader = isLeader(node.znode, children))) {
				log.debug('we are the leader');
				node.watching = null;
				return node.emit('leader');
			}

			var parent = getParent(node.znode, children);
			var zparent = node.zroot + '/' + parent;
			return node.watch(zparent, function(err) {
				if (err)
					return node.emit('error', err);

				return node.emit('watch', parent);
			});
		});
	};
}



// --- API

function Election(options) {
	assert.equal(typeof(options), 'object');

	var self = this;

	this._leader = false;
	this.log4js = options.log4js;
	this.log = this.log4js.getLogger('Election');
	this.watching = null;
	this.znode = '';
	this.zookeeper = options.zookeeper;
	this.zroot = options.znode;

	this.__defineGetter__('leader', function() {
		return self._leader;
	});
}
util.inherits(Election, EventEmitter);


Election.prototype.create = function create(callback) {
	assert.equal(typeof(callback), 'function');

	var log = this.log;
	var node = this.zroot + '/_';
	var self = this;
	var zk = this.zookeeper;

	log.debug('create entered: %s', node);
	return zk.a_create(node, null, ZNODE_FLAGS, function(rc, msg, path) {
		if (rc !== 0)
			return callback(new ZooKeeperError(rc, msg));

		log.debug('create: created (ephemeral) %s', path);
		self.znode = path;
		return callback(null, path);
	});
};


Election.prototype.list = function list(callback) {
	assert.equal(typeof(callback), 'function');
	var log = this.log;
	var zk = this.zookeeper;
	var znode = this.znode;
	var zroot = this.zroot;

	log.debug('list(%s: %s) entered', znode, zroot);
	return zk.a_get_children(zroot, false, function(rc, msg, children) {
		if (rc !== 0)
			return callback(new ZooKeeperError(rc, msg));

		if (!children)
			children = [];

		children.sort();

		log.debug('list(%s: %s): %s', znode, zroot, children.join());
		return callback(null, children);
	});
};


Election.prototype.watch = function watch(znode, callback) {
	assert.equal(typeof(znode), 'string');
	assert.equal(typeof(callback), 'function');

	var log = this.log;
	var self = this;
	var zk = this.zookeeper;

	log.debug('watch(%s) entered', znode);
	return zk.aw_get(znode, reelect(this), function(rc, msg) {
		if (rc !== 0)
			return callback(new ZooKeeperError(rc, msg));

		self.watching = znode;
		log.debug('watch(%s) done', znode);
		return callback(null);
	});
};


Election.prototype.vote = function vote(callback) {
	assert.equal(typeof(callback), 'function');

	var log = this.log;
	var self = this;

	log.debug('registering with zookeeper(%s)', this.zroot);
	return this.create(function(err, znode) {
		if (err)
			return callback(err);

		return self.list(function(err, children) {
			if (err)
				return callback(err);

			if ((self._leader = isLeader(znode, children))) {
				log.debug('we are the leader (%s)', self.znode);
				self.emit('leader');
				return callback(null, true);
			}

			var parent = getParent(znode, children);
			var zparent = self.zroot + '/' + parent;
			return self.watch(zparent, function(err) {
				if (err)
					return callback(err);

				log.debug('waiting for reelection (%s)', znode);
				self.emit('watch', parent);
				return callback(null, true);
			});
		});
	});
};


Election.prototype.close = function close(callback) {
	if (typeof(callback) !== 'function')
		throw new TypeError('callback (Function) required');

	var log = this.log;
	this._leader = false;
	this.zookeeper.once('close', function() {
		log.debug('closed');
		return callback();
	});

	log.debug('close()');
	this.zookeeper.close();
};



module.exports = function elect(options, callback) {
	if (typeof(options) !== 'object')
		throw new TypeError('options (Object) required');
	if (typeof(options.zookeeper) !== 'string')
		throw new TypeError('options.zookeeper (String) required');
	if (typeof(options.log4js) !== 'object')
		throw new TypeError('options.log4js (Object) required');
	if (typeof(options.znode) !== 'string')
		throw new TypeError('options.znode (String) required');
	if (options.timeout && typeof(options.timeout) !== 'number')
		throw new TypeError('options.timeout (Number) required');
	if (typeof(callback) !== 'function')
		throw new TypeError('callback (Function) required');

	var log = options.log4js.getLogger('Election');
	var zkLogLevel = ZooKeeper.ZOO_LOG_LEVEL_WARNING;

	if (log.isTraceEnabled())
		zkLogLevel = ZooKeeper.ZOO_LOG_LEVEL_DEBUG;


	var zookeeper = new ZooKeeper({
		connect: options.zookeeper,
		timeout: options.timeout || 1000,
		debug_level: zkLogLevel,
		host_order_deterministic: false
	});

	log.debug('connecting to zookeeper');
	return zookeeper.connect(function(err) {
		if (err)
			return callback(err);

		log.debug('connected to zookeeper.');

		var node = new Election({
			log4js: options.log4js,
			zookeeper: zookeeper,
			znode: options.znode
		});

		var cb = false;
		function _error(err) {
			if (cb)
				return false;

			cb = true;
			return callback(err);
		}

		node.once('error', _error);
		return node.vote(function(err) {
			node.removeListener('error', _error);
			if (cb)
				return false;
			cb = true;

			if (err)
				return callback(err);

			return callback(null, node);
		});
	});
};
