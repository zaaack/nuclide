Object.defineProperty(exports, '__esModule', {
  value: true
});

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _FileTreeConstants = require('./FileTreeConstants');

var _atom = require('atom');

var _FileTreeDispatcher = require('./FileTreeDispatcher');

var _FileTreeDispatcher2 = _interopRequireDefault(_FileTreeDispatcher);

var _FileTreeHelpers = require('./FileTreeHelpers');

var _FileTreeHelpers2 = _interopRequireDefault(_FileTreeHelpers);

var _FileTreeNode = require('./FileTreeNode');

var _FileTreeNode2 = _interopRequireDefault(_FileTreeNode);

var _immutable = require('immutable');

var _immutable2 = _interopRequireDefault(_immutable);

var _minimatch = require('minimatch');

var _hgGitBridge = require('../../hg-git-bridge');

var _commons = require('../../commons');

var _logging = require('../../logging');

var _shell = require('shell');

var _shell2 = _interopRequireDefault(_shell);

var _lodashMemoize = require('lodash.memoize');

var _lodashMemoize2 = _interopRequireDefault(_lodashMemoize);

// Used to ensure the version we serialized is the same version we are deserializing.
var VERSION = 1;

var instance = undefined;

/**
 * Implements the Flux pattern for our file tree. All state for the file tree will be kept in
 * FileTreeStore and the only way to update the store is through methods on FileTreeActions. The
 * dispatcher is a mechanism through which FileTreeActions interfaces with FileTreeStore.
 */

var FileTreeStore = (function () {
  _createClass(FileTreeStore, null, [{
    key: 'getInstance',
    value: function getInstance() {
      if (!instance) {
        instance = new FileTreeStore();
      }
      return instance;
    }
  }]);

  function FileTreeStore() {
    var _this = this;

    _classCallCheck(this, FileTreeStore);

    this._data = this._getDefaults();
    this._dispatcher = _FileTreeDispatcher2['default'].getInstance();
    this._emitter = new _atom.Emitter();
    this._dispatcher.register(function (payload) {
      return _this._onDispatch(payload);
    });
    this._logger = (0, _logging.getLogger)();
    this._repositoryForPath = (0, _lodashMemoize2['default'])(this._repositoryForPath);
  }

  // A helper to delete a property in an object using shallow copy rather than mutation

  /**
   * TODO: Move to a [serialization class][1] and use the built-in versioning mechanism. This might
   * need to be done one level higher within main.js.
   *
   * [1]: https://atom.io/docs/latest/behind-atom-serialization-in-atom
   */

  _createClass(FileTreeStore, [{
    key: 'exportData',
    value: function exportData() {
      var data = this._data;
      // Grab the child keys of only the expanded nodes.
      var childKeyMap = {};
      Object.keys(data.expandedKeysByRoot).forEach(function (rootKey) {
        var expandedKeySet = data.expandedKeysByRoot[rootKey];
        for (var _nodeKey of expandedKeySet) {
          childKeyMap[_nodeKey] = data.childKeyMap[_nodeKey];
        }
      });
      return {
        version: VERSION,
        childKeyMap: childKeyMap,
        expandedKeysByRoot: mapValues(data.expandedKeysByRoot, function (keySet) {
          return keySet.toArray();
        }),
        rootKeys: data.rootKeys,
        selectedKeysByRoot: mapValues(data.selectedKeysByRoot, function (keySet) {
          return keySet.toArray();
        })
      };
    }

    /**
     * Imports store data from a previous export.
     */
  }, {
    key: 'loadData',
    value: function loadData(data) {
      var _this2 = this;

      // Ensure we are not trying to load data from an earlier version of this package.
      if (data.version !== VERSION) {
        return;
      }
      this._data = _extends({}, this._getDefaults(), {
        childKeyMap: data.childKeyMap,
        expandedKeysByRoot: mapValues(data.expandedKeysByRoot, function (keys) {
          return new _immutable2['default'].Set(keys);
        }),
        rootKeys: data.rootKeys,
        selectedKeysByRoot: mapValues(data.selectedKeysByRoot, function (keys) {
          return new _immutable2['default'].OrderedSet(keys);
        })
      });
      Object.keys(data.childKeyMap).forEach(function (nodeKey) {
        _this2._addSubscription(nodeKey);
        _this2._fetchChildKeys(nodeKey);
      });
    }
  }, {
    key: '_setExcludeVcsIgnoredPaths',
    value: function _setExcludeVcsIgnoredPaths(excludeVcsIgnoredPaths) {
      this._set('excludeVcsIgnoredPaths', excludeVcsIgnoredPaths);
    }
  }, {
    key: '_setHideIgnoredNames',
    value: function _setHideIgnoredNames(hideIgnoredNames) {
      this._set('hideIgnoredNames', hideIgnoredNames);
    }

    /**
     * Given a list of names to ignore, compile them into minimatch patterns and
     * update the store with them.
     */
  }, {
    key: '_setIgnoredNames',
    value: function _setIgnoredNames(ignoredNames) {
      var ignoredPatterns = _immutable2['default'].Set(ignoredNames).map(function (ignoredName) {
        if (ignoredName === '') {
          return null;
        }
        try {
          return new _minimatch.Minimatch(ignoredName, { matchBase: true, dot: true });
        } catch (error) {
          atom.notifications.addWarning('Error parsing pattern \'' + ignoredName + '\' from "Settings" > "Ignored Names"', { detail: error.message });
          return null;
        }
      }).filter(function (pattern) {
        return pattern != null;
      });
      this._set('ignoredPatterns', ignoredPatterns);
    }
  }, {
    key: '_getDefaults',
    value: function _getDefaults() {
      return {
        childKeyMap: {},
        isDirtyMap: {},
        expandedKeysByRoot: {},
        trackedNode: null,
        previouslyExpanded: {},
        isLoadingMap: {},
        rootKeys: [],
        selectedKeysByRoot: {},
        subscriptionMap: {},
        vcsStatusesByRoot: {},
        ignoredPatterns: _immutable2['default'].Set(),
        hideIgnoredNames: true,
        excludeVcsIgnoredPaths: true,
        repositories: _immutable2['default'].Set()
      };
    }
  }, {
    key: '_onDispatch',
    value: function _onDispatch(payload) {
      switch (payload.actionType) {
        case _FileTreeConstants.ActionType.DELETE_SELECTED_NODES:
          this._deleteSelectedNodes();
          break;
        case _FileTreeConstants.ActionType.SET_TRACKED_NODE:
          this._setTrackedNode(payload.rootKey, payload.nodeKey);
          break;
        case _FileTreeConstants.ActionType.SET_ROOT_KEYS:
          this._setRootKeys(payload.rootKeys);
          break;
        case _FileTreeConstants.ActionType.EXPAND_NODE:
          this._expandNode(payload.rootKey, payload.nodeKey);
          break;
        case _FileTreeConstants.ActionType.EXPAND_NODE_DEEP:
          this._expandNodeDeep(payload.rootKey, payload.nodeKey);
          break;
        case _FileTreeConstants.ActionType.COLLAPSE_NODE:
          this._collapseNode(payload.rootKey, payload.nodeKey);
          break;
        case _FileTreeConstants.ActionType.SET_EXCLUDE_VCS_IGNORED_PATHS:
          this._setExcludeVcsIgnoredPaths(payload.excludeVcsIgnoredPaths);
          break;
        case _FileTreeConstants.ActionType.COLLAPSE_NODE_DEEP:
          this._purgeDirectoryWithinARoot(payload.rootKey, payload.nodeKey, /* unselect */false);
          break;
        case _FileTreeConstants.ActionType.SET_HIDE_IGNORED_NAMES:
          this._setHideIgnoredNames(payload.hideIgnoredNames);
          break;
        case _FileTreeConstants.ActionType.SET_IGNORED_NAMES:
          this._setIgnoredNames(payload.ignoredNames);
          break;
        case _FileTreeConstants.ActionType.SET_SELECTED_NODES_FOR_ROOT:
          this._setSelectedKeys(payload.rootKey, payload.nodeKeys);
          break;
        case _FileTreeConstants.ActionType.SET_SELECTED_NODES_FOR_TREE:
          this._setSelectedKeysByRoot(payload.selectedKeysByRoot);
          break;
        case _FileTreeConstants.ActionType.CREATE_CHILD:
          this._createChild(payload.nodeKey, payload.childKey);
          break;
        case _FileTreeConstants.ActionType.SET_VCS_STATUSES:
          this._setVcsStatuses(payload.rootKey, payload.vcsStatuses);
          break;
        case _FileTreeConstants.ActionType.SET_REPOSITORIES:
          this._setRepositories(payload.repositories);
          break;
      }
    }

    /**
     * This is a private method because in Flux we should never externally write to the data store.
     * Only by receiving actions (from dispatcher) should the data store be changed.
     * Note: `_set` can be called multiple times within one iteration of an event loop without
     * thrashing the UI because we are using setImmediate to batch change notifications, effectively
     * letting our views re-render once for multiple consecutive writes.
     */
  }, {
    key: '_set',
    value: function _set(key, value) {
      var _this3 = this;

      var flush = arguments.length <= 2 || arguments[2] === undefined ? false : arguments[2];

      var oldData = this._data;
      // Immutability for the win!
      var newData = setProperty(this._data, key, value);
      if (newData !== oldData) {
        this._data = newData;
        clearImmediate(this._timer);
        if (flush) {
          // If `flush` is true, emit the change immediately.
          this._emitter.emit('change');
        } else {
          // If not flushing, de-bounce to prevent successive updates in the same event loop.
          this._timer = setImmediate(function () {
            _this3._emitter.emit('change');
          });
        }
      }
    }
  }, {
    key: 'getTrackedNode',
    value: function getTrackedNode() {
      return this._data.trackedNode;
    }
  }, {
    key: 'getRepositories',
    value: function getRepositories() {
      return this._data.repositories;
    }
  }, {
    key: 'getRootKeys',
    value: function getRootKeys() {
      return this._data.rootKeys;
    }

    /**
     * Returns the key of the *first* root node containing the given node.
     */
  }, {
    key: 'getRootForKey',
    value: function getRootForKey(nodeKey) {
      return _commons.array.find(this._data.rootKeys, function (rootKey) {
        return nodeKey.startsWith(rootKey);
      });
    }

    /**
     * Returns true if the store has no data, i.e. no roots, no children.
     */
  }, {
    key: 'isEmpty',
    value: function isEmpty() {
      return this.getRootKeys().length === 0;
    }

    /**
     * Note: We actually don't need rootKey (implementation detail) but we take it for consistency.
     */
  }, {
    key: 'isLoading',
    value: function isLoading(rootKey, nodeKey) {
      return !!this._getLoading(nodeKey);
    }
  }, {
    key: 'isExpanded',
    value: function isExpanded(rootKey, nodeKey) {
      return this._getExpandedKeys(rootKey).has(nodeKey);
    }
  }, {
    key: 'isRootKey',
    value: function isRootKey(nodeKey) {
      return this._data.rootKeys.indexOf(nodeKey) !== -1;
    }
  }, {
    key: 'isSelected',
    value: function isSelected(rootKey, nodeKey) {
      return this.getSelectedKeys(rootKey).has(nodeKey);
    }
  }, {
    key: '_setVcsStatuses',
    value: function _setVcsStatuses(rootKey, vcsStatuses) {
      var immutableVcsStatuses = new _immutable2['default'].Map(vcsStatuses);
      if (!_immutable2['default'].is(immutableVcsStatuses, this._data.vcsStatusesByRoot[rootKey])) {
        this._set('vcsStatusesByRoot', setProperty(this._data.vcsStatusesByRoot, rootKey, immutableVcsStatuses));
      }
    }
  }, {
    key: 'getVcsStatusCode',
    value: function getVcsStatusCode(rootKey, nodeKey) {
      var map = this._data.vcsStatusesByRoot[rootKey];
      if (map) {
        return map.get(nodeKey);
      } else {
        return null;
      }
    }

    /**
     * Returns known child keys for the given `nodeKey` but does not queue a fetch for missing
     * children like `::getChildKeys`.
     */
  }, {
    key: 'getCachedChildKeys',
    value: function getCachedChildKeys(rootKey, nodeKey) {
      return this._omitHiddenPaths(this._data.childKeyMap[nodeKey] || []);
    }

    /**
     * The node child keys may either be  available immediately (cached), or
     * require an async fetch. If all of the children are needed it's easier to
     * return as promise, to make the caller oblivious to the way children were
     * fetched.
     */
  }, {
    key: 'promiseNodeChildKeys',
    value: function promiseNodeChildKeys(rootKey, nodeKey) {
      var _this4 = this;

      var cachedChildKeys = this.getChildKeys(rootKey, nodeKey);
      if (cachedChildKeys.length) {
        return Promise.resolve(cachedChildKeys);
      }

      var promise = this._getLoading(nodeKey) || Promise.resolve();
      return promise.then(function () {
        return _this4.getCachedChildKeys(rootKey, nodeKey);
      });
    }

    /**
     * Returns known child keys for the given `nodeKey` and queues a fetch if children are missing.
     */
  }, {
    key: 'getChildKeys',
    value: function getChildKeys(rootKey, nodeKey) {
      var childKeys = this._data.childKeyMap[nodeKey];
      if (childKeys == null || this._data.isDirtyMap[nodeKey]) {
        this._fetchChildKeys(nodeKey);
      } else {
        /*
         * If no data needs to be fetched, wipe out the scrolling state because subsequent updates
         * should no longer scroll the tree. The node will have already been flushed to the view and
         * scrolled to.
         */
        this._checkTrackedNode();
      }
      return this._omitHiddenPaths(childKeys || []);
    }
  }, {
    key: 'getSelectedKeys',
    value: function getSelectedKeys(rootKey) {
      var selectedKeys = undefined;
      if (rootKey == null) {
        selectedKeys = new _immutable2['default'].OrderedSet();
        for (var root in this._data.selectedKeysByRoot) {
          if (this._data.selectedKeysByRoot.hasOwnProperty(root)) {
            selectedKeys = selectedKeys.merge(this._data.selectedKeysByRoot[root]);
          }
        }
      } else {
        // If the given `rootKey` has no selected keys, assign an empty set to maintain a non-null
        // return value.
        selectedKeys = this._data.selectedKeysByRoot[rootKey] || new _immutable2['default'].OrderedSet();
      }
      return selectedKeys;
    }

    /**
     * Returns a list of the nodes that are currently visible/expanded in the file tree.
     *
     * This method returns an array synchronously (rather than an iterator) to ensure the caller
     * gets a consistent snapshot of the current state of the file tree.
     */
  }, {
    key: 'getVisibleNodes',
    value: function getVisibleNodes(rootKey) {
      // Do some basic checks to ensure that rootKey corresponds to a root and is expanded. If not,
      // return the appropriate array.
      if (!this.isRootKey(rootKey)) {
        return [];
      }
      if (!this.isExpanded(rootKey, rootKey)) {
        return [this.getNode(rootKey, rootKey)];
      }

      // Note that we could cache the visibleNodes array so that we do not have to create it from
      // scratch each time this is called, but it does not appear to be a bottleneck at present.
      var visibleNodes = [];
      var rootKeysForDirectoriesToExplore = [rootKey];
      while (rootKeysForDirectoriesToExplore.length !== 0) {
        var _key = rootKeysForDirectoriesToExplore.pop();
        visibleNodes.push(this.getNode(_key, _key));
        var childKeys = this._data.childKeyMap[_key];
        if (childKeys == null || this._data.isDirtyMap[_key]) {
          // This is where getChildKeys() would fetch, but we do not want to do that.
          // TODO: If key is in isDirtyMap, then retry when it is not dirty?
          continue;
        }

        for (var childKey of childKeys) {
          if (_FileTreeHelpers2['default'].isDirKey(childKey)) {
            if (this.isExpanded(rootKey, _key)) {
              rootKeysForDirectoriesToExplore.push(childKey);
            }
          } else {
            visibleNodes.push(this.getNode(_key, childKey));
          }
        }
      }
      return visibleNodes;
    }

    /**
     * Returns all selected nodes across all roots in the tree.
     */
  }, {
    key: 'getSelectedNodes',
    value: function getSelectedNodes() {
      var _this5 = this;

      var selectedNodes = new _immutable2['default'].OrderedSet();
      this._data.rootKeys.forEach(function (rootKey) {
        _this5.getSelectedKeys(rootKey).forEach(function (nodeKey) {
          selectedNodes = selectedNodes.add(_this5.getNode(rootKey, nodeKey));
        });
      });
      return selectedNodes;
    }
  }, {
    key: 'getSingleSelectedNode',
    value: function getSingleSelectedNode() {
      var selectedRoots = Object.keys(this._data.selectedKeysByRoot);
      if (selectedRoots.length !== 1) {
        // There is more than one root with selected nodes. No bueno.
        return null;
      }
      var rootKey = selectedRoots[0];
      var selectedKeys = this.getSelectedKeys(rootKey);
      /*
       * Note: This does not call `getSelectedNodes` to prevent creating nodes that would be thrown
       * away if there is more than 1 selected node.
       */
      return selectedKeys.size === 1 ? this.getNode(rootKey, selectedKeys.first()) : null;
    }
  }, {
    key: 'getRootNode',
    value: function getRootNode(rootKey) {
      return this.getNode(rootKey, rootKey);
    }
  }, {
    key: 'getNode',
    value: function getNode(rootKey, nodeKey) {
      return new _FileTreeNode2['default'](this, rootKey, nodeKey);
    }

    /**
     * If a fetch is not already in progress initiate a fetch now.
     */
  }, {
    key: '_fetchChildKeys',
    value: function _fetchChildKeys(nodeKey) {
      var _this6 = this;

      var existingPromise = this._getLoading(nodeKey);
      if (existingPromise) {
        return existingPromise;
      }

      var promise = _FileTreeHelpers2['default'].fetchChildren(nodeKey)['catch'](function (error) {
        _this6._logger.error('Unable to fetch children for "' + nodeKey + '".');
        _this6._logger.error('Original error: ', error);
        // Collapse the node and clear its loading state on error so the user can retry expanding it.
        var rootKey = _this6.getRootForKey(nodeKey);
        if (rootKey != null) {
          _this6._collapseNode(rootKey, nodeKey);
        }
        _this6._clearLoading(nodeKey);
      }).then(function (childKeys) {
        // If this node's root went away while the Promise was resolving, do no more work. This node
        // is no longer needed in the store.
        if (_this6.getRootForKey(nodeKey) == null) {
          return;
        }
        _this6._setChildKeys(nodeKey, childKeys);
        _this6._addSubscription(nodeKey);
        _this6._clearLoading(nodeKey);
      });

      this._setLoading(nodeKey, promise);
      return promise;
    }
  }, {
    key: '_getLoading',
    value: function _getLoading(nodeKey) {
      return this._data.isLoadingMap[nodeKey];
    }
  }, {
    key: '_setLoading',
    value: function _setLoading(nodeKey, value) {
      this._set('isLoadingMap', setProperty(this._data.isLoadingMap, nodeKey, value));
    }

    /**
     * Resets the node to be kept in view if no more data is being awaited. Safe to call many times
     * because it only changes state if a node is being tracked.
     */
  }, {
    key: '_checkTrackedNode',
    value: function _checkTrackedNode() {
      if (this._data.trackedNode != null &&
      /*
       * The loading map being empty is a heuristic for when loading has completed. It is inexact
       * because the loading might be unrelated to the tracked node, however it is cheap and false
       * positives will only last until loading is complete or until the user clicks another node in
       * the tree.
       */
      _commons.object.isEmpty(this._data.isLoadingMap)) {
        // Loading has completed. Allow scrolling to proceed as usual.
        this._set('trackedNode', null);
      }
    }
  }, {
    key: '_clearLoading',
    value: function _clearLoading(nodeKey) {
      this._set('isLoadingMap', deleteProperty(this._data.isLoadingMap, nodeKey));
      this._checkTrackedNode();
    }
  }, {
    key: '_deleteSelectedNodes',
    value: function _deleteSelectedNodes() {
      var selectedNodes = this.getSelectedNodes();
      selectedNodes.forEach(function (node) {
        var file = _FileTreeHelpers2['default'].getFileByKey(node.nodeKey);
        if (file != null) {
          if (_FileTreeHelpers2['default'].isLocalFile(file)) {
            // TODO: This special-case can be eliminated once `delete()` is added to `Directory`
            // and `File`.
            _shell2['default'].moveItemToTrash(node.nodePath);
          } else {
            file['delete']();
          }
        }
      });
    }
  }, {
    key: '_expandNode',
    value: function _expandNode(rootKey, nodeKey) {
      this._setExpandedKeys(rootKey, this._getExpandedKeys(rootKey).add(nodeKey));
      // If we have child nodes that should also be expanded, expand them now.
      var previouslyExpanded = this._getPreviouslyExpanded(rootKey);
      if (previouslyExpanded.has(nodeKey)) {
        for (var childKey of previouslyExpanded.get(nodeKey)) {
          this._expandNode(rootKey, childKey);
        }
        // Clear the previouslyExpanded list since we're done with it.
        previouslyExpanded = previouslyExpanded['delete'](nodeKey);
        this._setPreviouslyExpanded(rootKey, previouslyExpanded);
      }
    }

    /**
     * Performes a deep BFS scanning expand of contained nodes.
     * returns - a promise fulfilled when the expand operation is finished
     */
  }, {
    key: '_expandNodeDeep',
    value: function _expandNodeDeep(rootKey, nodeKey) {
      var _this7 = this;

      // Stop the traversal after 100 nodes were added to the tree
      var itNodes = new FileTreeStoreBfsIterator(this, rootKey, nodeKey, /* limit*/100);
      var promise = new Promise(function (resolve) {
        var expand = function expand() {
          var traversedNodeKey = itNodes.traversedNode();
          if (traversedNodeKey) {
            _this7._setExpandedKeys(rootKey, _this7._getExpandedKeys(rootKey).add(traversedNodeKey));
            /**
             * Even if there were previously expanded nodes it doesn't matter as
             * we'll expand all of the children.
             */
            var _previouslyExpanded = _this7._getPreviouslyExpanded(rootKey);
            _previouslyExpanded = _previouslyExpanded['delete'](traversedNodeKey);
            _this7._setPreviouslyExpanded(rootKey, _previouslyExpanded);

            var nextPromise = itNodes.next();
            if (nextPromise) {
              nextPromise.then(expand);
            }
          } else {
            resolve();
          }
        };

        expand();
      });

      return promise;
    }

    /**
     * When we collapse a node we need to do some cleanup removing subscriptions and selection.
     */
  }, {
    key: '_collapseNode',
    value: function _collapseNode(rootKey, nodeKey) {
      var _this8 = this;

      var childKeys = this._data.childKeyMap[nodeKey];
      var selectedKeys = this._data.selectedKeysByRoot[rootKey];
      var expandedChildKeys = [];
      if (childKeys) {
        childKeys.forEach(function (childKey) {
          // Unselect each child.
          if (selectedKeys && selectedKeys.has(childKey)) {
            selectedKeys = selectedKeys['delete'](childKey);
            /*
             * Set the selected keys *before* the recursive `_collapseNode` call so each call stores
             * its changes and isn't wiped out by the next call by keeping an outdated `selectedKeys`
             * in the call stack.
             */
            _this8._setSelectedKeys(rootKey, selectedKeys);
          }
          // Collapse each child directory.
          if (_FileTreeHelpers2['default'].isDirKey(childKey)) {
            if (_this8.isExpanded(rootKey, childKey)) {
              expandedChildKeys.push(childKey);
              _this8._collapseNode(rootKey, childKey);
            }
          }
        });
      }
      /*
       * Save the list of expanded child nodes so next time we expand this node we can expand these
       * children.
       */
      var previouslyExpanded = this._getPreviouslyExpanded(rootKey);
      if (expandedChildKeys.length !== 0) {
        previouslyExpanded = previouslyExpanded.set(nodeKey, expandedChildKeys);
      } else {
        previouslyExpanded = previouslyExpanded['delete'](nodeKey);
      }
      this._setPreviouslyExpanded(rootKey, previouslyExpanded);
      this._setExpandedKeys(rootKey, this._getExpandedKeys(rootKey)['delete'](nodeKey));
      this._removeSubscription(rootKey, nodeKey);
    }
  }, {
    key: '_getPreviouslyExpanded',
    value: function _getPreviouslyExpanded(rootKey) {
      return this._data.previouslyExpanded[rootKey] || new _immutable2['default'].Map();
    }
  }, {
    key: '_setPreviouslyExpanded',
    value: function _setPreviouslyExpanded(rootKey, previouslyExpanded) {
      this._set('previouslyExpanded', setProperty(this._data.previouslyExpanded, rootKey, previouslyExpanded));
    }
  }, {
    key: '_getExpandedKeys',
    value: function _getExpandedKeys(rootKey) {
      return this._data.expandedKeysByRoot[rootKey] || new _immutable2['default'].Set();
    }

    /**
     * This is just exposed so it can be mocked in the tests. Not ideal, but a lot less messy than the
     * alternatives. For example, passing options when constructing an instance of a singleton would
     * make future invocations of `getInstance` unpredictable.
     */
  }, {
    key: '_repositoryForPath',
    value: function _repositoryForPath(path) {
      return this.getRepositories().find(function (repo) {
        return (0, _hgGitBridge.repositoryContainsPath)(repo, path);
      });
    }
  }, {
    key: '_setExpandedKeys',
    value: function _setExpandedKeys(rootKey, expandedKeys) {
      this._set('expandedKeysByRoot', setProperty(this._data.expandedKeysByRoot, rootKey, expandedKeys));
    }
  }, {
    key: '_deleteSelectedKeys',
    value: function _deleteSelectedKeys(rootKey) {
      this._set('selectedKeysByRoot', deleteProperty(this._data.selectedKeysByRoot, rootKey));
    }
  }, {
    key: '_setSelectedKeys',
    value: function _setSelectedKeys(rootKey, selectedKeys) {
      /*
       * New selection means previous node should not be kept in view. Do this without de-bouncing
       * because the previous state is irrelevant. If the user chose a new selection, the previous one
       * should not be scrolled into view.
       */
      this._set('trackedNode', null);
      this._set('selectedKeysByRoot', setProperty(this._data.selectedKeysByRoot, rootKey, selectedKeys));
    }

    /**
     * Sets the selected keys in all roots of the tree. The selected keys of root keys not in
     * `selectedKeysByRoot` are deleted (the root is left with no selection).
     */
  }, {
    key: '_setSelectedKeysByRoot',
    value: function _setSelectedKeysByRoot(selectedKeysByRoot) {
      var _this9 = this;

      this.getRootKeys().forEach(function (rootKey) {
        if (selectedKeysByRoot.hasOwnProperty(rootKey)) {
          _this9._setSelectedKeys(rootKey, selectedKeysByRoot[rootKey]);
        } else {
          _this9._deleteSelectedKeys(rootKey);
        }
      });
    }
  }, {
    key: '_setRootKeys',
    value: function _setRootKeys(rootKeys) {
      var oldRootKeys = this._data.rootKeys;
      var newRootKeys = new _immutable2['default'].Set(rootKeys);
      var removedRootKeys = new _immutable2['default'].Set(oldRootKeys).subtract(newRootKeys);
      removedRootKeys.forEach(this._purgeRoot.bind(this));
      this._set('rootKeys', rootKeys);
    }

    /**
     * Sets a single child node. It's useful when expanding to a deeply nested node.
     */
  }, {
    key: '_createChild',
    value: function _createChild(nodeKey, childKey) {
      this._setChildKeys(nodeKey, [childKey]);
      /*
       * Mark the node as dirty so its ancestors are fetched again on reload of the tree.
       */
      this._set('isDirtyMap', setProperty(this._data.isDirtyMap, nodeKey, true));
    }
  }, {
    key: '_setChildKeys',
    value: function _setChildKeys(nodeKey, childKeys) {
      var oldChildKeys = this._data.childKeyMap[nodeKey];
      if (oldChildKeys) {
        var newChildKeys = new _immutable2['default'].Set(childKeys);
        var removedDirectoryKeys = new _immutable2['default'].Set(oldChildKeys).subtract(newChildKeys).filter(_FileTreeHelpers2['default'].isDirKey);
        removedDirectoryKeys.forEach(this._purgeDirectory.bind(this));
      }
      this._set('childKeyMap', setProperty(this._data.childKeyMap, nodeKey, childKeys));
    }
  }, {
    key: '_onDirectoryChange',
    value: function _onDirectoryChange(nodeKey) {
      this._fetchChildKeys(nodeKey);
    }
  }, {
    key: '_addSubscription',
    value: function _addSubscription(nodeKey) {
      var _this10 = this;

      var directory = _FileTreeHelpers2['default'].getDirectoryByKey(nodeKey);
      if (!directory) {
        return;
      }

      /*
       * Remove the directory's dirty marker regardless of whether a subscription already exists
       * because there is nothing further making it dirty.
       */
      this._set('isDirtyMap', deleteProperty(this._data.isDirtyMap, nodeKey));

      // Don't create a new subscription if one already exists.
      if (this._data.subscriptionMap[nodeKey]) {
        return;
      }

      var subscription = undefined;
      try {
        // This call might fail if we try to watch a non-existing directory, or if permission denied.
        subscription = directory.onDidChange(function () {
          _this10._onDirectoryChange(nodeKey);
        });
      } catch (ex) {
        /*
         * Log error and mark the directory as dirty so the failed subscription will be attempted
         * again next time the directory is expanded.
         */
        this._logger.error('Cannot subscribe to directory "' + nodeKey + '"', ex);
        this._set('isDirtyMap', setProperty(this._data.isDirtyMap, nodeKey));
        return;
      }
      this._set('subscriptionMap', setProperty(this._data.subscriptionMap, nodeKey, subscription));
    }
  }, {
    key: '_removeSubscription',
    value: function _removeSubscription(rootKey, nodeKey) {
      var _this11 = this;

      var hasRemainingSubscribers = undefined;
      var subscription = this._data.subscriptionMap[nodeKey];

      if (subscription != null) {
        hasRemainingSubscribers = this._data.rootKeys.some(function (otherRootKey) {
          return otherRootKey !== rootKey && _this11.isExpanded(otherRootKey, nodeKey);
        });
        if (!hasRemainingSubscribers) {
          subscription.dispose();
          this._set('subscriptionMap', deleteProperty(this._data.subscriptionMap, nodeKey));
        }
      }

      if (subscription == null || hasRemainingSubscribers === false) {
        // Since we're no longer getting notifications when the directory contents change, assume the
        // child list is dirty.
        this._set('isDirtyMap', setProperty(this._data.isDirtyMap, nodeKey, true));
      }
    }
  }, {
    key: '_removeAllSubscriptions',
    value: function _removeAllSubscriptions(nodeKey) {
      var subscription = this._data.subscriptionMap[nodeKey];
      if (subscription) {
        subscription.dispose();
        this._set('subscriptionMap', deleteProperty(this._data.subscriptionMap, nodeKey));
      }
    }
  }, {
    key: '_purgeNode',
    value: function _purgeNode(rootKey, nodeKey, unselect) {
      var expandedKeys = this._getExpandedKeys(rootKey);
      if (expandedKeys.has(nodeKey)) {
        this._setExpandedKeys(rootKey, expandedKeys['delete'](nodeKey));
      }

      if (unselect) {
        var selectedKeys = this.getSelectedKeys(rootKey);
        if (selectedKeys.has(nodeKey)) {
          this._setSelectedKeys(rootKey, selectedKeys['delete'](nodeKey));
        }
      }

      var previouslyExpanded = this._getPreviouslyExpanded(rootKey);
      if (previouslyExpanded.has(nodeKey)) {
        this._setPreviouslyExpanded(rootKey, previouslyExpanded['delete'](nodeKey));
      }
    }
  }, {
    key: '_purgeDirectoryWithinARoot',
    value: function _purgeDirectoryWithinARoot(rootKey, nodeKey, unselect) {
      var _this12 = this;

      var childKeys = this._data.childKeyMap[nodeKey];
      if (childKeys) {
        childKeys.forEach(function (childKey) {
          if (_FileTreeHelpers2['default'].isDirKey(childKey)) {
            _this12._purgeDirectoryWithinARoot(rootKey, childKey, /* unselect */true);
          }
        });
      }
      this._removeSubscription(rootKey, nodeKey);
      this._purgeNode(rootKey, nodeKey, unselect);
    }

    // This is called when a dirctory is physically removed from disk. When we purge a directory,
    // we need to purge it's child directories also. Purging removes stuff from the data store
    // including list of child nodes, subscriptions, expanded directories and selected directories.
  }, {
    key: '_purgeDirectory',
    value: function _purgeDirectory(nodeKey) {
      var _this13 = this;

      var childKeys = this._data.childKeyMap[nodeKey];
      if (childKeys) {
        childKeys.forEach(function (childKey) {
          if (_FileTreeHelpers2['default'].isDirKey(childKey)) {
            _this13._purgeDirectory(childKey);
          }
        });
        this._set('childKeyMap', deleteProperty(this._data.childKeyMap, nodeKey));
      }

      this._removeAllSubscriptions(nodeKey);
      this.getRootKeys().forEach(function (rootKey) {
        _this13._purgeNode(rootKey, nodeKey, /* unselect */true);
      });
    }

    // TODO: Should we clean up isLoadingMap? It contains promises which cannot be cancelled, so this
    // might be tricky.
  }, {
    key: '_purgeRoot',
    value: function _purgeRoot(rootKey) {
      var _this14 = this;

      var expandedKeys = this._data.expandedKeysByRoot[rootKey];
      if (expandedKeys) {
        expandedKeys.forEach(function (nodeKey) {
          _this14._removeSubscription(rootKey, nodeKey);
        });
        this._set('expandedKeysByRoot', deleteProperty(this._data.expandedKeysByRoot, rootKey));
      }
      this._set('selectedKeysByRoot', deleteProperty(this._data.selectedKeysByRoot, rootKey));
      // Remove all child keys so that on re-addition of this root the children will be fetched again.
      var childKeys = this._data.childKeyMap[rootKey];
      if (childKeys) {
        childKeys.forEach(function (childKey) {
          if (_FileTreeHelpers2['default'].isDirKey(childKey)) {
            _this14._set('childKeyMap', deleteProperty(_this14._data.childKeyMap, childKey));
          }
        });
        this._set('childKeyMap', deleteProperty(this._data.childKeyMap, rootKey));
      }
      this._set('vcsStatusesByRoot', deleteProperty(this._data.vcsStatusesByRoot, rootKey));
    }
  }, {
    key: '_setTrackedNode',
    value: function _setTrackedNode(rootKey, nodeKey) {
      // Flush the value to ensure clients see the value at least once and scroll appropriately.
      this._set('trackedNode', { nodeKey: nodeKey, rootKey: rootKey }, true);
    }
  }, {
    key: '_setRepositories',
    value: function _setRepositories(repositories) {
      this._set('repositories', repositories);

      // Whenever a new set of repositories comes in, invalidate our paths cache by resetting its
      // `cache` property (created by lodash.memoize) to an empty map.
      this._repositoryForPath.cache = new Map();
    }
  }, {
    key: '_omitHiddenPaths',
    value: function _omitHiddenPaths(nodeKeys) {
      var _this15 = this;

      if (!this._data.hideIgnoredNames && !this._data.excludeVcsIgnoredPaths) {
        return nodeKeys;
      }

      return nodeKeys.filter(function (nodeKey) {
        return !_this15._shouldHidePath(nodeKey);
      });
    }
  }, {
    key: '_shouldHidePath',
    value: function _shouldHidePath(nodeKey) {
      var _data = this._data;
      var hideIgnoredNames = _data.hideIgnoredNames;
      var excludeVcsIgnoredPaths = _data.excludeVcsIgnoredPaths;
      var ignoredPatterns = _data.ignoredPatterns;

      if (hideIgnoredNames && matchesSome(nodeKey, ignoredPatterns)) {
        return true;
      }
      if (excludeVcsIgnoredPaths && isVcsIgnored(nodeKey, this._repositoryForPath(nodeKey))) {
        return true;
      }
      return false;
    }
  }, {
    key: 'reset',
    value: function reset() {
      var subscriptionMap = this._data.subscriptionMap;
      for (var _nodeKey2 of Object.keys(subscriptionMap)) {
        var subscription = subscriptionMap[_nodeKey2];
        if (subscription) {
          subscription.dispose();
        }
      }

      // Reset data store.
      this._data = this._getDefaults();
    }
  }, {
    key: 'subscribe',
    value: function subscribe(listener) {
      return this._emitter.on('change', listener);
    }
  }]);

  return FileTreeStore;
})();

function deleteProperty(object, key) {
  if (!object.hasOwnProperty(key)) {
    return object;
  }
  var newObject = _extends({}, object);
  delete newObject[key];
  return newObject;
}

// A helper to set a property in an object using shallow copy rather than mutation
function setProperty(object, key, newValue) {
  var oldValue = object[key];
  if (oldValue === newValue) {
    return object;
  }
  var newObject = _extends({}, object);
  newObject[key] = newValue;
  return newObject;
}

// Create a new object by mapping over the properties of a given object, calling the given
// function on each one.
function mapValues(object, fn) {
  var newObject = {};
  Object.keys(object).forEach(function (key) {
    newObject[key] = fn(object[key], key);
  });
  return newObject;
}

// Determine whether the given string matches any of a set of patterns.
function matchesSome(str, patterns) {
  return patterns.some(function (pattern) {
    return pattern.match(str);
  });
}

function isVcsIgnored(nodeKey, repo) {
  return repo && repo.isProjectAtRoot() && repo.isPathIgnored(nodeKey);
}

/**
 * Performs a breadth-first iteration over the directories of the tree starting
 * with a given node. The iteration stops once a given limit of nodes (both directories
 * and files) were traversed.
 * The node being currently traversed can be obtained by calling .traversedNode()
 * .next() returns a promise that is fulfilled when the traversal moves on to
 * the next directory.
 */

var FileTreeStoreBfsIterator = (function () {
  function FileTreeStoreBfsIterator(fileTreeStore, rootKey, nodeKey, limit) {
    _classCallCheck(this, FileTreeStoreBfsIterator);

    this._fileTreeStore = fileTreeStore;
    this._rootKey = rootKey;
    this._nodesToTraverse = [];
    this._currentlyTraversedNode = nodeKey;
    this._limit = limit;
    this._numNodesTraversed = 0;
    this._promise = null;
    this._count = 0;
  }

  _createClass(FileTreeStoreBfsIterator, [{
    key: '_handlePromiseResolution',
    value: function _handlePromiseResolution(childrenKeys) {
      this._numNodesTraversed += childrenKeys.length;
      if (this._numNodesTraversed < this._limit) {
        var nextLevelNodes = childrenKeys.filter(function (childKey) {
          return _FileTreeHelpers2['default'].isDirKey(childKey);
        });
        this._nodesToTraverse = this._nodesToTraverse.concat(nextLevelNodes);

        this._currentlyTraversedNode = this._nodesToTraverse.splice(0, 1)[0];
        this._promise = null;
      } else {
        this._currentlyTraversedNode = null;
        this._promise = null;
      }

      return;
    }
  }, {
    key: 'next',
    value: function next() {
      var currentlyTraversedNode = this._currentlyTraversedNode;
      if (!this._promise && currentlyTraversedNode) {
        this._promise = this._fileTreeStore.promiseNodeChildKeys(this._rootKey, currentlyTraversedNode).then(this._handlePromiseResolution.bind(this));
      }
      return this._promise;
    }
  }, {
    key: 'traversedNode',
    value: function traversedNode() {
      return this._currentlyTraversedNode;
    }
  }]);

  return FileTreeStoreBfsIterator;
})();

module.exports = FileTreeStore;

// Saves a list of child nodes that should be expande when a given key is expanded.
// Looks like: { rootKey: { nodeKey: [childKey1, childKey2] } }.
//# sourceMappingURL=data:application/json;base64,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LEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQzs7QUFFckUsWUFBSSxDQUFDLHVCQUF1QixHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3JFLFlBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDO09BQ3RCLE1BQ0k7QUFDSCxZQUFJLENBQUMsdUJBQXVCLEdBQUcsSUFBSSxDQUFDO0FBQ3BDLFlBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDO09BQ3RCOztBQUVELGFBQU87S0FDUjs7O1dBRUcsZ0JBQW1CO0FBQ3JCLFVBQU0sc0JBQXNCLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDO0FBQzVELFVBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLHNCQUFzQixFQUFFO0FBQzVDLFlBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FDdEQsSUFBSSxDQUFDLFFBQVEsRUFDYixzQkFBc0IsQ0FBQyxDQUN4QixJQUFJLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO09BQ2pEO0FBQ0QsYUFBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0tBQ3RCOzs7V0FFWSx5QkFBWTtBQUN2QixhQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FBQztLQUNyQzs7O1NBdkRHLHdCQUF3Qjs7O0FBMEQ5QixNQUFNLENBQUMsT0FBTyxHQUFHLGFBQWEsQ0FBQyIsImZpbGUiOiJGaWxlVHJlZVN0b3JlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBiYWJlbCc7XG4vKiBAZmxvdyAqL1xuXG4vKlxuICogQ29weXJpZ2h0IChjKSAyMDE1LXByZXNlbnQsIEZhY2Vib29rLCBJbmMuXG4gKiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuICpcbiAqIFRoaXMgc291cmNlIGNvZGUgaXMgbGljZW5zZWQgdW5kZXIgdGhlIGxpY2Vuc2UgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpblxuICogdGhlIHJvb3QgZGlyZWN0b3J5IG9mIHRoaXMgc291cmNlIHRyZWUuXG4gKi9cblxuaW1wb3J0IHR5cGUge1xuICBSZW1vdGVEaXJlY3RvcnksXG4gIFJlbW90ZUZpbGUsXG59IGZyb20gJy4uLy4uL3JlbW90ZS1jb25uZWN0aW9uJztcblxuaW1wb3J0IHtBY3Rpb25UeXBlfSBmcm9tICcuL0ZpbGVUcmVlQ29uc3RhbnRzJztcbmltcG9ydCB7RGlzcG9zYWJsZSwgRW1pdHRlcn0gZnJvbSAnYXRvbSc7XG5pbXBvcnQgRmlsZVRyZWVEaXNwYXRjaGVyIGZyb20gJy4vRmlsZVRyZWVEaXNwYXRjaGVyJztcbmltcG9ydCBGaWxlVHJlZUhlbHBlcnMgZnJvbSAnLi9GaWxlVHJlZUhlbHBlcnMnO1xuaW1wb3J0IEZpbGVUcmVlTm9kZSBmcm9tICcuL0ZpbGVUcmVlTm9kZSc7XG5pbXBvcnQgSW1tdXRhYmxlIGZyb20gJ2ltbXV0YWJsZSc7XG5pbXBvcnQge01pbmltYXRjaH0gZnJvbSAnbWluaW1hdGNoJztcbmltcG9ydCB7cmVwb3NpdG9yeUNvbnRhaW5zUGF0aH0gZnJvbSAnLi4vLi4vaGctZ2l0LWJyaWRnZSc7XG5cbmltcG9ydCB7YXJyYXl9IGZyb20gJy4uLy4uL2NvbW1vbnMnO1xuaW1wb3J0IHtnZXRMb2dnZXJ9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHtvYmplY3QgYXMgb2JqZWN0VXRpbH0gZnJvbSAnLi4vLi4vY29tbW9ucyc7XG5pbXBvcnQgc2hlbGwgZnJvbSAnc2hlbGwnO1xuaW1wb3J0IG1lbW9pemUgZnJvbSAnbG9kYXNoLm1lbW9pemUnO1xuXG4vLyBVc2VkIHRvIGVuc3VyZSB0aGUgdmVyc2lvbiB3ZSBzZXJpYWxpemVkIGlzIHRoZSBzYW1lIHZlcnNpb24gd2UgYXJlIGRlc2VyaWFsaXppbmcuXG5jb25zdCBWRVJTSU9OID0gMTtcblxuaW1wb3J0IHR5cGUge0Rpc3BhdGNoZXJ9IGZyb20gJ2ZsdXgnO1xuaW1wb3J0IHR5cGUge051Y2xpZGVVcml9IGZyb20gJy4uLy4uL3JlbW90ZS11cmknO1xuXG50eXBlIEFjdGlvblBheWxvYWQgPSBPYmplY3Q7XG50eXBlIENoYW5nZUxpc3RlbmVyID0gKCkgPT4gbWl4ZWQ7XG50eXBlIEZpbGVUcmVlTm9kZURhdGEgPSB7XG4gIG5vZGVLZXk6IHN0cmluZztcbiAgcm9vdEtleTogc3RyaW5nO1xufVxuXG50eXBlIFN0b3JlRGF0YSA9IHtcbiAgY2hpbGRLZXlNYXA6IHsgW2tleTogc3RyaW5nXTogQXJyYXk8c3RyaW5nPiB9O1xuICBpc0RpcnR5TWFwOiB7IFtrZXk6IHN0cmluZ106IGJvb2xlYW4gfTtcbiAgZXhwYW5kZWRLZXlzQnlSb290OiB7IFtrZXk6IHN0cmluZ106IEltbXV0YWJsZS5TZXQ8c3RyaW5nPiB9O1xuICB0cmFja2VkTm9kZTogP0ZpbGVUcmVlTm9kZURhdGE7XG4gIC8vIFNhdmVzIGEgbGlzdCBvZiBjaGlsZCBub2RlcyB0aGF0IHNob3VsZCBiZSBleHBhbmRlIHdoZW4gYSBnaXZlbiBrZXkgaXMgZXhwYW5kZWQuXG4gIC8vIExvb2tzIGxpa2U6IHsgcm9vdEtleTogeyBub2RlS2V5OiBbY2hpbGRLZXkxLCBjaGlsZEtleTJdIH0gfS5cbiAgcHJldmlvdXNseUV4cGFuZGVkOiB7IFtyb290S2V5OiBzdHJpbmddOiBJbW11dGFibGUuTWFwPHN0cmluZywgQXJyYXk8U3RyaW5nPj4gfTtcbiAgaXNMb2FkaW5nTWFwOiB7IFtrZXk6IHN0cmluZ106ID9Qcm9taXNlIH07XG4gIHJvb3RLZXlzOiBBcnJheTxzdHJpbmc+O1xuICBzZWxlY3RlZEtleXNCeVJvb3Q6IHsgW2tleTogc3RyaW5nXTogSW1tdXRhYmxlLk9yZGVyZWRTZXQ8c3RyaW5nPiB9O1xuICBzdWJzY3JpcHRpb25NYXA6IHsgW2tleTogc3RyaW5nXTogRGlzcG9zYWJsZSB9O1xuICB2Y3NTdGF0dXNlc0J5Um9vdDogeyBba2V5OiBzdHJpbmddOiBJbW11dGFibGUuTWFwPHN0cmluZywgbnVtYmVyPiB9O1xuICBpZ25vcmVkUGF0dGVybnM6IEltbXV0YWJsZS5TZXQ8TWluaW1hdGNoPjtcbiAgaGlkZUlnbm9yZWROYW1lczogYm9vbGVhbjtcbiAgZXhjbHVkZVZjc0lnbm9yZWRQYXRoczogYm9vbGVhbjtcbiAgcmVwb3NpdG9yaWVzOiBJbW11dGFibGUuU2V0PGF0b20kUmVwb3NpdG9yeT47XG59O1xuXG5leHBvcnQgdHlwZSBFeHBvcnRTdG9yZURhdGEgPSB7XG4gIGNoaWxkS2V5TWFwOiB7IFtrZXk6IHN0cmluZ106IEFycmF5PHN0cmluZz4gfTtcbiAgZXhwYW5kZWRLZXlzQnlSb290OiB7IFtrZXk6IHN0cmluZ106IEFycmF5PHN0cmluZz4gfTtcbiAgcm9vdEtleXM6IEFycmF5PHN0cmluZz47XG4gIHNlbGVjdGVkS2V5c0J5Um9vdDogeyBba2V5OiBzdHJpbmddOiBBcnJheTxzdHJpbmc+IH07XG59O1xuXG5sZXQgaW5zdGFuY2U6ID9PYmplY3Q7XG5cbi8qKlxuICogSW1wbGVtZW50cyB0aGUgRmx1eCBwYXR0ZXJuIGZvciBvdXIgZmlsZSB0cmVlLiBBbGwgc3RhdGUgZm9yIHRoZSBmaWxlIHRyZWUgd2lsbCBiZSBrZXB0IGluXG4gKiBGaWxlVHJlZVN0b3JlIGFuZCB0aGUgb25seSB3YXkgdG8gdXBkYXRlIHRoZSBzdG9yZSBpcyB0aHJvdWdoIG1ldGhvZHMgb24gRmlsZVRyZWVBY3Rpb25zLiBUaGVcbiAqIGRpc3BhdGNoZXIgaXMgYSBtZWNoYW5pc20gdGhyb3VnaCB3aGljaCBGaWxlVHJlZUFjdGlvbnMgaW50ZXJmYWNlcyB3aXRoIEZpbGVUcmVlU3RvcmUuXG4gKi9cbmNsYXNzIEZpbGVUcmVlU3RvcmUge1xuICBfZGF0YTogU3RvcmVEYXRhO1xuICBfZGlzcGF0Y2hlcjogRGlzcGF0Y2hlcjtcbiAgX2VtaXR0ZXI6IEVtaXR0ZXI7XG4gIF9sb2dnZXI6IGFueTtcbiAgX3RpbWVyOiA/T2JqZWN0O1xuICBfcmVwb3NpdG9yeUZvclBhdGg6IChwYXRoOiBOdWNsaWRlVXJpKSA9PiA/YXRvbSRSZXBvc2l0b3J5O1xuXG4gIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBGaWxlVHJlZVN0b3JlIHtcbiAgICBpZiAoIWluc3RhbmNlKSB7XG4gICAgICBpbnN0YW5jZSA9IG5ldyBGaWxlVHJlZVN0b3JlKCk7XG4gICAgfVxuICAgIHJldHVybiBpbnN0YW5jZTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuX2RhdGEgPSB0aGlzLl9nZXREZWZhdWx0cygpO1xuICAgIHRoaXMuX2Rpc3BhdGNoZXIgPSBGaWxlVHJlZURpc3BhdGNoZXIuZ2V0SW5zdGFuY2UoKTtcbiAgICB0aGlzLl9lbWl0dGVyID0gbmV3IEVtaXR0ZXIoKTtcbiAgICB0aGlzLl9kaXNwYXRjaGVyLnJlZ2lzdGVyKFxuICAgICAgcGF5bG9hZCA9PiB0aGlzLl9vbkRpc3BhdGNoKHBheWxvYWQpXG4gICAgKTtcbiAgICB0aGlzLl9sb2dnZXIgPSBnZXRMb2dnZXIoKTtcbiAgICB0aGlzLl9yZXBvc2l0b3J5Rm9yUGF0aCA9IG1lbW9pemUodGhpcy5fcmVwb3NpdG9yeUZvclBhdGgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRPRE86IE1vdmUgdG8gYSBbc2VyaWFsaXphdGlvbiBjbGFzc11bMV0gYW5kIHVzZSB0aGUgYnVpbHQtaW4gdmVyc2lvbmluZyBtZWNoYW5pc20uIFRoaXMgbWlnaHRcbiAgICogbmVlZCB0byBiZSBkb25lIG9uZSBsZXZlbCBoaWdoZXIgd2l0aGluIG1haW4uanMuXG4gICAqXG4gICAqIFsxXTogaHR0cHM6Ly9hdG9tLmlvL2RvY3MvbGF0ZXN0L2JlaGluZC1hdG9tLXNlcmlhbGl6YXRpb24taW4tYXRvbVxuICAgKi9cbiAgZXhwb3J0RGF0YSgpOiBFeHBvcnRTdG9yZURhdGEge1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLl9kYXRhO1xuICAgIC8vIEdyYWIgdGhlIGNoaWxkIGtleXMgb2Ygb25seSB0aGUgZXhwYW5kZWQgbm9kZXMuXG4gICAgY29uc3QgY2hpbGRLZXlNYXAgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhkYXRhLmV4cGFuZGVkS2V5c0J5Um9vdCkuZm9yRWFjaCgocm9vdEtleSkgPT4ge1xuICAgICAgY29uc3QgZXhwYW5kZWRLZXlTZXQgPSBkYXRhLmV4cGFuZGVkS2V5c0J5Um9vdFtyb290S2V5XTtcbiAgICAgIGZvciAoY29uc3Qgbm9kZUtleSBvZiBleHBhbmRlZEtleVNldCkge1xuICAgICAgICBjaGlsZEtleU1hcFtub2RlS2V5XSA9IGRhdGEuY2hpbGRLZXlNYXBbbm9kZUtleV07XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHZlcnNpb246IFZFUlNJT04sXG4gICAgICBjaGlsZEtleU1hcDogY2hpbGRLZXlNYXAsXG4gICAgICBleHBhbmRlZEtleXNCeVJvb3Q6IG1hcFZhbHVlcyhkYXRhLmV4cGFuZGVkS2V5c0J5Um9vdCwgKGtleVNldCkgPT4ga2V5U2V0LnRvQXJyYXkoKSksXG4gICAgICByb290S2V5czogZGF0YS5yb290S2V5cyxcbiAgICAgIHNlbGVjdGVkS2V5c0J5Um9vdDogbWFwVmFsdWVzKGRhdGEuc2VsZWN0ZWRLZXlzQnlSb290LCAoa2V5U2V0KSA9PiBrZXlTZXQudG9BcnJheSgpKSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEltcG9ydHMgc3RvcmUgZGF0YSBmcm9tIGEgcHJldmlvdXMgZXhwb3J0LlxuICAgKi9cbiAgbG9hZERhdGEoZGF0YTogRXhwb3J0U3RvcmVEYXRhKTogdm9pZCB7XG4gICAgLy8gRW5zdXJlIHdlIGFyZSBub3QgdHJ5aW5nIHRvIGxvYWQgZGF0YSBmcm9tIGFuIGVhcmxpZXIgdmVyc2lvbiBvZiB0aGlzIHBhY2thZ2UuXG4gICAgaWYgKGRhdGEudmVyc2lvbiAhPT0gVkVSU0lPTikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9kYXRhID0ge1xuICAgICAgLi4udGhpcy5fZ2V0RGVmYXVsdHMoKSxcbiAgICAgIC4uLntcbiAgICAgICAgY2hpbGRLZXlNYXA6IGRhdGEuY2hpbGRLZXlNYXAsXG4gICAgICAgIGV4cGFuZGVkS2V5c0J5Um9vdDogbWFwVmFsdWVzKGRhdGEuZXhwYW5kZWRLZXlzQnlSb290LCAoa2V5cykgPT4gbmV3IEltbXV0YWJsZS5TZXQoa2V5cykpLFxuICAgICAgICByb290S2V5czogZGF0YS5yb290S2V5cyxcbiAgICAgICAgc2VsZWN0ZWRLZXlzQnlSb290OlxuICAgICAgICAgIG1hcFZhbHVlcyhkYXRhLnNlbGVjdGVkS2V5c0J5Um9vdCwgKGtleXMpID0+IG5ldyBJbW11dGFibGUuT3JkZXJlZFNldChrZXlzKSksXG4gICAgICB9LFxuICAgIH07XG4gICAgT2JqZWN0LmtleXMoZGF0YS5jaGlsZEtleU1hcCkuZm9yRWFjaCgobm9kZUtleSkgPT4ge1xuICAgICAgdGhpcy5fYWRkU3Vic2NyaXB0aW9uKG5vZGVLZXkpO1xuICAgICAgdGhpcy5fZmV0Y2hDaGlsZEtleXMobm9kZUtleSk7XG4gICAgfSk7XG4gIH1cblxuICBfc2V0RXhjbHVkZVZjc0lnbm9yZWRQYXRocyhleGNsdWRlVmNzSWdub3JlZFBhdGhzOiBib29sZWFuKTogdm9pZCB7XG4gICAgdGhpcy5fc2V0KCdleGNsdWRlVmNzSWdub3JlZFBhdGhzJywgZXhjbHVkZVZjc0lnbm9yZWRQYXRocyk7XG4gIH1cblxuICBfc2V0SGlkZUlnbm9yZWROYW1lcyhoaWRlSWdub3JlZE5hbWVzOiBib29sZWFuKTogdm9pZCB7XG4gICAgdGhpcy5fc2V0KCdoaWRlSWdub3JlZE5hbWVzJywgaGlkZUlnbm9yZWROYW1lcyk7XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYSBsaXN0IG9mIG5hbWVzIHRvIGlnbm9yZSwgY29tcGlsZSB0aGVtIGludG8gbWluaW1hdGNoIHBhdHRlcm5zIGFuZFxuICAgKiB1cGRhdGUgdGhlIHN0b3JlIHdpdGggdGhlbS5cbiAgICovXG4gIF9zZXRJZ25vcmVkTmFtZXMoaWdub3JlZE5hbWVzOiBBcnJheTxzdHJpbmc+KSB7XG4gICAgY29uc3QgaWdub3JlZFBhdHRlcm5zID0gSW1tdXRhYmxlLlNldChpZ25vcmVkTmFtZXMpXG4gICAgICAubWFwKGlnbm9yZWROYW1lID0+IHtcbiAgICAgICAgaWYgKGlnbm9yZWROYW1lID09PSAnJykge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBNaW5pbWF0Y2goaWdub3JlZE5hbWUsIHttYXRjaEJhc2U6IHRydWUsIGRvdDogdHJ1ZX0pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGF0b20ubm90aWZpY2F0aW9ucy5hZGRXYXJuaW5nKFxuICAgICAgICAgICAgYEVycm9yIHBhcnNpbmcgcGF0dGVybiAnJHtpZ25vcmVkTmFtZX0nIGZyb20gXCJTZXR0aW5nc1wiID4gXCJJZ25vcmVkIE5hbWVzXCJgLFxuICAgICAgICAgICAge2RldGFpbDogZXJyb3IubWVzc2FnZX0sXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5maWx0ZXIocGF0dGVybiA9PiBwYXR0ZXJuICE9IG51bGwpO1xuICAgIHRoaXMuX3NldCgnaWdub3JlZFBhdHRlcm5zJywgaWdub3JlZFBhdHRlcm5zKTtcbiAgfVxuXG4gIF9nZXREZWZhdWx0cygpOiBTdG9yZURhdGEge1xuICAgIHJldHVybiB7XG4gICAgICBjaGlsZEtleU1hcDoge30sXG4gICAgICBpc0RpcnR5TWFwOiB7fSxcbiAgICAgIGV4cGFuZGVkS2V5c0J5Um9vdDoge30sXG4gICAgICB0cmFja2VkTm9kZTogbnVsbCxcbiAgICAgIHByZXZpb3VzbHlFeHBhbmRlZDoge30sXG4gICAgICBpc0xvYWRpbmdNYXA6IHt9LFxuICAgICAgcm9vdEtleXM6IFtdLFxuICAgICAgc2VsZWN0ZWRLZXlzQnlSb290OiB7fSxcbiAgICAgIHN1YnNjcmlwdGlvbk1hcDoge30sXG4gICAgICB2Y3NTdGF0dXNlc0J5Um9vdDoge30sXG4gICAgICBpZ25vcmVkUGF0dGVybnM6IEltbXV0YWJsZS5TZXQoKSxcbiAgICAgIGhpZGVJZ25vcmVkTmFtZXM6IHRydWUsXG4gICAgICBleGNsdWRlVmNzSWdub3JlZFBhdGhzOiB0cnVlLFxuICAgICAgcmVwb3NpdG9yaWVzOiBJbW11dGFibGUuU2V0KCksXG4gICAgfTtcbiAgfVxuXG4gIF9vbkRpc3BhdGNoKHBheWxvYWQ6IEFjdGlvblBheWxvYWQpOiB2b2lkIHtcbiAgICBzd2l0Y2ggKHBheWxvYWQuYWN0aW9uVHlwZSkge1xuICAgICAgY2FzZSBBY3Rpb25UeXBlLkRFTEVURV9TRUxFQ1RFRF9OT0RFUzpcbiAgICAgICAgdGhpcy5fZGVsZXRlU2VsZWN0ZWROb2RlcygpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgQWN0aW9uVHlwZS5TRVRfVFJBQ0tFRF9OT0RFOlxuICAgICAgICB0aGlzLl9zZXRUcmFja2VkTm9kZShwYXlsb2FkLnJvb3RLZXksIHBheWxvYWQubm9kZUtleSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBBY3Rpb25UeXBlLlNFVF9ST09UX0tFWVM6XG4gICAgICAgIHRoaXMuX3NldFJvb3RLZXlzKHBheWxvYWQucm9vdEtleXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgQWN0aW9uVHlwZS5FWFBBTkRfTk9ERTpcbiAgICAgICAgdGhpcy5fZXhwYW5kTm9kZShwYXlsb2FkLnJvb3RLZXksIHBheWxvYWQubm9kZUtleSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBBY3Rpb25UeXBlLkVYUEFORF9OT0RFX0RFRVA6XG4gICAgICAgIHRoaXMuX2V4cGFuZE5vZGVEZWVwKHBheWxvYWQucm9vdEtleSwgcGF5bG9hZC5ub2RlS2V5KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuQ09MTEFQU0VfTk9ERTpcbiAgICAgICAgdGhpcy5fY29sbGFwc2VOb2RlKHBheWxvYWQucm9vdEtleSwgcGF5bG9hZC5ub2RlS2V5KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuU0VUX0VYQ0xVREVfVkNTX0lHTk9SRURfUEFUSFM6XG4gICAgICAgIHRoaXMuX3NldEV4Y2x1ZGVWY3NJZ25vcmVkUGF0aHMocGF5bG9hZC5leGNsdWRlVmNzSWdub3JlZFBhdGhzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuQ09MTEFQU0VfTk9ERV9ERUVQOlxuICAgICAgICB0aGlzLl9wdXJnZURpcmVjdG9yeVdpdGhpbkFSb290KHBheWxvYWQucm9vdEtleSwgcGF5bG9hZC5ub2RlS2V5LCAvKiB1bnNlbGVjdCAqL2ZhbHNlKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuU0VUX0hJREVfSUdOT1JFRF9OQU1FUzpcbiAgICAgICAgdGhpcy5fc2V0SGlkZUlnbm9yZWROYW1lcyhwYXlsb2FkLmhpZGVJZ25vcmVkTmFtZXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgQWN0aW9uVHlwZS5TRVRfSUdOT1JFRF9OQU1FUzpcbiAgICAgICAgdGhpcy5fc2V0SWdub3JlZE5hbWVzKHBheWxvYWQuaWdub3JlZE5hbWVzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuU0VUX1NFTEVDVEVEX05PREVTX0ZPUl9ST09UOlxuICAgICAgICB0aGlzLl9zZXRTZWxlY3RlZEtleXMocGF5bG9hZC5yb290S2V5LCBwYXlsb2FkLm5vZGVLZXlzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIEFjdGlvblR5cGUuU0VUX1NFTEVDVEVEX05PREVTX0ZPUl9UUkVFOlxuICAgICAgICB0aGlzLl9zZXRTZWxlY3RlZEtleXNCeVJvb3QocGF5bG9hZC5zZWxlY3RlZEtleXNCeVJvb3QpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgQWN0aW9uVHlwZS5DUkVBVEVfQ0hJTEQ6XG4gICAgICAgIHRoaXMuX2NyZWF0ZUNoaWxkKHBheWxvYWQubm9kZUtleSwgcGF5bG9hZC5jaGlsZEtleSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBBY3Rpb25UeXBlLlNFVF9WQ1NfU1RBVFVTRVM6XG4gICAgICAgIHRoaXMuX3NldFZjc1N0YXR1c2VzKHBheWxvYWQucm9vdEtleSwgcGF5bG9hZC52Y3NTdGF0dXNlcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBBY3Rpb25UeXBlLlNFVF9SRVBPU0lUT1JJRVM6XG4gICAgICAgIHRoaXMuX3NldFJlcG9zaXRvcmllcyhwYXlsb2FkLnJlcG9zaXRvcmllcyk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIGlzIGEgcHJpdmF0ZSBtZXRob2QgYmVjYXVzZSBpbiBGbHV4IHdlIHNob3VsZCBuZXZlciBleHRlcm5hbGx5IHdyaXRlIHRvIHRoZSBkYXRhIHN0b3JlLlxuICAgKiBPbmx5IGJ5IHJlY2VpdmluZyBhY3Rpb25zIChmcm9tIGRpc3BhdGNoZXIpIHNob3VsZCB0aGUgZGF0YSBzdG9yZSBiZSBjaGFuZ2VkLlxuICAgKiBOb3RlOiBgX3NldGAgY2FuIGJlIGNhbGxlZCBtdWx0aXBsZSB0aW1lcyB3aXRoaW4gb25lIGl0ZXJhdGlvbiBvZiBhbiBldmVudCBsb29wIHdpdGhvdXRcbiAgICogdGhyYXNoaW5nIHRoZSBVSSBiZWNhdXNlIHdlIGFyZSB1c2luZyBzZXRJbW1lZGlhdGUgdG8gYmF0Y2ggY2hhbmdlIG5vdGlmaWNhdGlvbnMsIGVmZmVjdGl2ZWx5XG4gICAqIGxldHRpbmcgb3VyIHZpZXdzIHJlLXJlbmRlciBvbmNlIGZvciBtdWx0aXBsZSBjb25zZWN1dGl2ZSB3cml0ZXMuXG4gICAqL1xuICBfc2V0KGtleTogc3RyaW5nLCB2YWx1ZTogbWl4ZWQsIGZsdXNoOiBib29sZWFuID0gZmFsc2UpOiB2b2lkIHtcbiAgICBjb25zdCBvbGREYXRhID0gdGhpcy5fZGF0YTtcbiAgICAvLyBJbW11dGFiaWxpdHkgZm9yIHRoZSB3aW4hXG4gICAgY29uc3QgbmV3RGF0YSA9IHNldFByb3BlcnR5KHRoaXMuX2RhdGEsIGtleSwgdmFsdWUpO1xuICAgIGlmIChuZXdEYXRhICE9PSBvbGREYXRhKSB7XG4gICAgICB0aGlzLl9kYXRhID0gbmV3RGF0YTtcbiAgICAgIGNsZWFySW1tZWRpYXRlKHRoaXMuX3RpbWVyKTtcbiAgICAgIGlmIChmbHVzaCkge1xuICAgICAgICAvLyBJZiBgZmx1c2hgIGlzIHRydWUsIGVtaXQgdGhlIGNoYW5nZSBpbW1lZGlhdGVseS5cbiAgICAgICAgdGhpcy5fZW1pdHRlci5lbWl0KCdjaGFuZ2UnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIG5vdCBmbHVzaGluZywgZGUtYm91bmNlIHRvIHByZXZlbnQgc3VjY2Vzc2l2ZSB1cGRhdGVzIGluIHRoZSBzYW1lIGV2ZW50IGxvb3AuXG4gICAgICAgIHRoaXMuX3RpbWVyID0gc2V0SW1tZWRpYXRlKCgpID0+IHtcbiAgICAgICAgICB0aGlzLl9lbWl0dGVyLmVtaXQoJ2NoYW5nZScpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXRUcmFja2VkTm9kZSgpOiA/RmlsZVRyZWVOb2RlRGF0YSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGEudHJhY2tlZE5vZGU7XG4gIH1cblxuICBnZXRSZXBvc2l0b3JpZXMoKTogSW1tdXRhYmxlLlNldDxhdG9tJFJlcG9zaXRvcnk+IHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YS5yZXBvc2l0b3JpZXM7XG4gIH1cblxuICBnZXRSb290S2V5cygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YS5yb290S2V5cztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBrZXkgb2YgdGhlICpmaXJzdCogcm9vdCBub2RlIGNvbnRhaW5pbmcgdGhlIGdpdmVuIG5vZGUuXG4gICAqL1xuICBnZXRSb290Rm9yS2V5KG5vZGVLZXk6IHN0cmluZyk6ID9zdHJpbmcge1xuICAgIHJldHVybiBhcnJheS5maW5kKHRoaXMuX2RhdGEucm9vdEtleXMsIHJvb3RLZXkgPT4gbm9kZUtleS5zdGFydHNXaXRoKHJvb3RLZXkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIHN0b3JlIGhhcyBubyBkYXRhLCBpLmUuIG5vIHJvb3RzLCBubyBjaGlsZHJlbi5cbiAgICovXG4gIGlzRW1wdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0Um9vdEtleXMoKS5sZW5ndGggPT09IDA7XG4gIH1cblxuICAvKipcbiAgICogTm90ZTogV2UgYWN0dWFsbHkgZG9uJ3QgbmVlZCByb290S2V5IChpbXBsZW1lbnRhdGlvbiBkZXRhaWwpIGJ1dCB3ZSB0YWtlIGl0IGZvciBjb25zaXN0ZW5jeS5cbiAgICovXG4gIGlzTG9hZGluZyhyb290S2V5OiBzdHJpbmcsIG5vZGVLZXk6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIXRoaXMuX2dldExvYWRpbmcobm9kZUtleSk7XG4gIH1cblxuICBpc0V4cGFuZGVkKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEV4cGFuZGVkS2V5cyhyb290S2V5KS5oYXMobm9kZUtleSk7XG4gIH1cblxuICBpc1Jvb3RLZXkobm9kZUtleTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGEucm9vdEtleXMuaW5kZXhPZihub2RlS2V5KSAhPT0gLTE7XG4gIH1cblxuICBpc1NlbGVjdGVkKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0U2VsZWN0ZWRLZXlzKHJvb3RLZXkpLmhhcyhub2RlS2V5KTtcbiAgfVxuXG4gIF9zZXRWY3NTdGF0dXNlcyhyb290S2V5OiBzdHJpbmcsIHZjc1N0YXR1c2VzOiB7W3BhdGg6IHN0cmluZ106IG51bWJlcn0pIHtcbiAgICBjb25zdCBpbW11dGFibGVWY3NTdGF0dXNlcyA9IG5ldyBJbW11dGFibGUuTWFwKHZjc1N0YXR1c2VzKTtcbiAgICBpZiAoIUltbXV0YWJsZS5pcyhpbW11dGFibGVWY3NTdGF0dXNlcywgdGhpcy5fZGF0YS52Y3NTdGF0dXNlc0J5Um9vdFtyb290S2V5XSkpIHtcbiAgICAgIHRoaXMuX3NldChcbiAgICAgICAgJ3Zjc1N0YXR1c2VzQnlSb290JyxcbiAgICAgICAgc2V0UHJvcGVydHkodGhpcy5fZGF0YS52Y3NTdGF0dXNlc0J5Um9vdCwgcm9vdEtleSwgaW1tdXRhYmxlVmNzU3RhdHVzZXMpXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGdldFZjc1N0YXR1c0NvZGUocm9vdEtleTogc3RyaW5nLCBub2RlS2V5OiBzdHJpbmcpOiA/bnVtYmVyIHtcbiAgICBjb25zdCBtYXAgPSB0aGlzLl9kYXRhLnZjc1N0YXR1c2VzQnlSb290W3Jvb3RLZXldO1xuICAgIGlmIChtYXApIHtcbiAgICAgIHJldHVybiBtYXAuZ2V0KG5vZGVLZXkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBrbm93biBjaGlsZCBrZXlzIGZvciB0aGUgZ2l2ZW4gYG5vZGVLZXlgIGJ1dCBkb2VzIG5vdCBxdWV1ZSBhIGZldGNoIGZvciBtaXNzaW5nXG4gICAqIGNoaWxkcmVuIGxpa2UgYDo6Z2V0Q2hpbGRLZXlzYC5cbiAgICovXG4gIGdldENhY2hlZENoaWxkS2V5cyhyb290S2V5OiBzdHJpbmcsIG5vZGVLZXk6IHN0cmluZyk6IEFycmF5PHN0cmluZz4ge1xuICAgIHJldHVybiB0aGlzLl9vbWl0SGlkZGVuUGF0aHModGhpcy5fZGF0YS5jaGlsZEtleU1hcFtub2RlS2V5XSB8fCBbXSk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5vZGUgY2hpbGQga2V5cyBtYXkgZWl0aGVyIGJlICBhdmFpbGFibGUgaW1tZWRpYXRlbHkgKGNhY2hlZCksIG9yXG4gICAqIHJlcXVpcmUgYW4gYXN5bmMgZmV0Y2guIElmIGFsbCBvZiB0aGUgY2hpbGRyZW4gYXJlIG5lZWRlZCBpdCdzIGVhc2llciB0b1xuICAgKiByZXR1cm4gYXMgcHJvbWlzZSwgdG8gbWFrZSB0aGUgY2FsbGVyIG9ibGl2aW91cyB0byB0aGUgd2F5IGNoaWxkcmVuIHdlcmVcbiAgICogZmV0Y2hlZC5cbiAgICovXG4gIHByb21pc2VOb2RlQ2hpbGRLZXlzKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogUHJvbWlzZSB7XG4gICAgY29uc3QgY2FjaGVkQ2hpbGRLZXlzID0gdGhpcy5nZXRDaGlsZEtleXMocm9vdEtleSwgbm9kZUtleSk7XG4gICAgaWYgKGNhY2hlZENoaWxkS2V5cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoY2FjaGVkQ2hpbGRLZXlzKTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5fZ2V0TG9hZGluZyhub2RlS2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKTtcbiAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHRoaXMuZ2V0Q2FjaGVkQ2hpbGRLZXlzKHJvb3RLZXksIG5vZGVLZXkpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGtub3duIGNoaWxkIGtleXMgZm9yIHRoZSBnaXZlbiBgbm9kZUtleWAgYW5kIHF1ZXVlcyBhIGZldGNoIGlmIGNoaWxkcmVuIGFyZSBtaXNzaW5nLlxuICAgKi9cbiAgZ2V0Q2hpbGRLZXlzKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgY29uc3QgY2hpbGRLZXlzID0gdGhpcy5fZGF0YS5jaGlsZEtleU1hcFtub2RlS2V5XTtcbiAgICBpZiAoY2hpbGRLZXlzID09IG51bGwgfHwgdGhpcy5fZGF0YS5pc0RpcnR5TWFwW25vZGVLZXldKSB7XG4gICAgICB0aGlzLl9mZXRjaENoaWxkS2V5cyhub2RlS2V5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLypcbiAgICAgICAqIElmIG5vIGRhdGEgbmVlZHMgdG8gYmUgZmV0Y2hlZCwgd2lwZSBvdXQgdGhlIHNjcm9sbGluZyBzdGF0ZSBiZWNhdXNlIHN1YnNlcXVlbnQgdXBkYXRlc1xuICAgICAgICogc2hvdWxkIG5vIGxvbmdlciBzY3JvbGwgdGhlIHRyZWUuIFRoZSBub2RlIHdpbGwgaGF2ZSBhbHJlYWR5IGJlZW4gZmx1c2hlZCB0byB0aGUgdmlldyBhbmRcbiAgICAgICAqIHNjcm9sbGVkIHRvLlxuICAgICAgICovXG4gICAgICB0aGlzLl9jaGVja1RyYWNrZWROb2RlKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9vbWl0SGlkZGVuUGF0aHMoY2hpbGRLZXlzIHx8IFtdKTtcbiAgfVxuXG4gIGdldFNlbGVjdGVkS2V5cyhyb290S2V5Pzogc3RyaW5nKTogSW1tdXRhYmxlLk9yZGVyZWRTZXQ8c3RyaW5nPiB7XG4gICAgbGV0IHNlbGVjdGVkS2V5cztcbiAgICBpZiAocm9vdEtleSA9PSBudWxsKSB7XG4gICAgICBzZWxlY3RlZEtleXMgPSBuZXcgSW1tdXRhYmxlLk9yZGVyZWRTZXQoKTtcbiAgICAgIGZvciAoY29uc3Qgcm9vdCBpbiB0aGlzLl9kYXRhLnNlbGVjdGVkS2V5c0J5Um9vdCkge1xuICAgICAgICBpZiAodGhpcy5fZGF0YS5zZWxlY3RlZEtleXNCeVJvb3QuaGFzT3duUHJvcGVydHkocm9vdCkpIHtcbiAgICAgICAgICBzZWxlY3RlZEtleXMgPSBzZWxlY3RlZEtleXMubWVyZ2UodGhpcy5fZGF0YS5zZWxlY3RlZEtleXNCeVJvb3Rbcm9vdF0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHRoZSBnaXZlbiBgcm9vdEtleWAgaGFzIG5vIHNlbGVjdGVkIGtleXMsIGFzc2lnbiBhbiBlbXB0eSBzZXQgdG8gbWFpbnRhaW4gYSBub24tbnVsbFxuICAgICAgLy8gcmV0dXJuIHZhbHVlLlxuICAgICAgc2VsZWN0ZWRLZXlzID0gdGhpcy5fZGF0YS5zZWxlY3RlZEtleXNCeVJvb3Rbcm9vdEtleV0gfHwgbmV3IEltbXV0YWJsZS5PcmRlcmVkU2V0KCk7XG4gICAgfVxuICAgIHJldHVybiBzZWxlY3RlZEtleXM7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGxpc3Qgb2YgdGhlIG5vZGVzIHRoYXQgYXJlIGN1cnJlbnRseSB2aXNpYmxlL2V4cGFuZGVkIGluIHRoZSBmaWxlIHRyZWUuXG4gICAqXG4gICAqIFRoaXMgbWV0aG9kIHJldHVybnMgYW4gYXJyYXkgc3luY2hyb25vdXNseSAocmF0aGVyIHRoYW4gYW4gaXRlcmF0b3IpIHRvIGVuc3VyZSB0aGUgY2FsbGVyXG4gICAqIGdldHMgYSBjb25zaXN0ZW50IHNuYXBzaG90IG9mIHRoZSBjdXJyZW50IHN0YXRlIG9mIHRoZSBmaWxlIHRyZWUuXG4gICAqL1xuICBnZXRWaXNpYmxlTm9kZXMocm9vdEtleTogc3RyaW5nKTogQXJyYXk8RmlsZVRyZWVOb2RlPiB7XG4gICAgLy8gRG8gc29tZSBiYXNpYyBjaGVja3MgdG8gZW5zdXJlIHRoYXQgcm9vdEtleSBjb3JyZXNwb25kcyB0byBhIHJvb3QgYW5kIGlzIGV4cGFuZGVkLiBJZiBub3QsXG4gICAgLy8gcmV0dXJuIHRoZSBhcHByb3ByaWF0ZSBhcnJheS5cbiAgICBpZiAoIXRoaXMuaXNSb290S2V5KHJvb3RLZXkpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICAgIGlmICghdGhpcy5pc0V4cGFuZGVkKHJvb3RLZXksIHJvb3RLZXkpKSB7XG4gICAgICByZXR1cm4gW3RoaXMuZ2V0Tm9kZShyb290S2V5LCByb290S2V5KV07XG4gICAgfVxuXG4gICAgLy8gTm90ZSB0aGF0IHdlIGNvdWxkIGNhY2hlIHRoZSB2aXNpYmxlTm9kZXMgYXJyYXkgc28gdGhhdCB3ZSBkbyBub3QgaGF2ZSB0byBjcmVhdGUgaXQgZnJvbVxuICAgIC8vIHNjcmF0Y2ggZWFjaCB0aW1lIHRoaXMgaXMgY2FsbGVkLCBidXQgaXQgZG9lcyBub3QgYXBwZWFyIHRvIGJlIGEgYm90dGxlbmVjayBhdCBwcmVzZW50LlxuICAgIGNvbnN0IHZpc2libGVOb2RlcyA9IFtdO1xuICAgIGNvbnN0IHJvb3RLZXlzRm9yRGlyZWN0b3JpZXNUb0V4cGxvcmUgPSBbcm9vdEtleV07XG4gICAgd2hpbGUgKHJvb3RLZXlzRm9yRGlyZWN0b3JpZXNUb0V4cGxvcmUubGVuZ3RoICE9PSAwKSB7XG4gICAgICBjb25zdCBrZXkgPSByb290S2V5c0ZvckRpcmVjdG9yaWVzVG9FeHBsb3JlLnBvcCgpO1xuICAgICAgdmlzaWJsZU5vZGVzLnB1c2godGhpcy5nZXROb2RlKGtleSwga2V5KSk7XG4gICAgICBjb25zdCBjaGlsZEtleXMgPSB0aGlzLl9kYXRhLmNoaWxkS2V5TWFwW2tleV07XG4gICAgICBpZiAoY2hpbGRLZXlzID09IG51bGwgfHwgdGhpcy5fZGF0YS5pc0RpcnR5TWFwW2tleV0pIHtcbiAgICAgICAgLy8gVGhpcyBpcyB3aGVyZSBnZXRDaGlsZEtleXMoKSB3b3VsZCBmZXRjaCwgYnV0IHdlIGRvIG5vdCB3YW50IHRvIGRvIHRoYXQuXG4gICAgICAgIC8vIFRPRE86IElmIGtleSBpcyBpbiBpc0RpcnR5TWFwLCB0aGVuIHJldHJ5IHdoZW4gaXQgaXMgbm90IGRpcnR5P1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZEtleSBvZiBjaGlsZEtleXMpIHtcbiAgICAgICAgaWYgKEZpbGVUcmVlSGVscGVycy5pc0RpcktleShjaGlsZEtleSkpIHtcbiAgICAgICAgICBpZiAodGhpcy5pc0V4cGFuZGVkKHJvb3RLZXksIGtleSkpIHtcbiAgICAgICAgICAgIHJvb3RLZXlzRm9yRGlyZWN0b3JpZXNUb0V4cGxvcmUucHVzaChjaGlsZEtleSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZpc2libGVOb2Rlcy5wdXNoKHRoaXMuZ2V0Tm9kZShrZXksIGNoaWxkS2V5KSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHZpc2libGVOb2RlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFsbCBzZWxlY3RlZCBub2RlcyBhY3Jvc3MgYWxsIHJvb3RzIGluIHRoZSB0cmVlLlxuICAgKi9cbiAgZ2V0U2VsZWN0ZWROb2RlcygpOiBJbW11dGFibGUuT3JkZXJlZFNldDxGaWxlVHJlZU5vZGU+IHtcbiAgICBsZXQgc2VsZWN0ZWROb2RlcyA9IG5ldyBJbW11dGFibGUuT3JkZXJlZFNldCgpO1xuICAgIHRoaXMuX2RhdGEucm9vdEtleXMuZm9yRWFjaChyb290S2V5ID0+IHtcbiAgICAgIHRoaXMuZ2V0U2VsZWN0ZWRLZXlzKHJvb3RLZXkpLmZvckVhY2gobm9kZUtleSA9PiB7XG4gICAgICAgIHNlbGVjdGVkTm9kZXMgPSBzZWxlY3RlZE5vZGVzLmFkZCh0aGlzLmdldE5vZGUocm9vdEtleSwgbm9kZUtleSkpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHNlbGVjdGVkTm9kZXM7XG4gIH1cblxuICBnZXRTaW5nbGVTZWxlY3RlZE5vZGUoKTogP0ZpbGVUcmVlTm9kZSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRSb290cyA9IE9iamVjdC5rZXlzKHRoaXMuX2RhdGEuc2VsZWN0ZWRLZXlzQnlSb290KTtcbiAgICBpZiAoc2VsZWN0ZWRSb290cy5sZW5ndGggIT09IDEpIHtcbiAgICAgIC8vIFRoZXJlIGlzIG1vcmUgdGhhbiBvbmUgcm9vdCB3aXRoIHNlbGVjdGVkIG5vZGVzLiBObyBidWVuby5cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCByb290S2V5ID0gc2VsZWN0ZWRSb290c1swXTtcbiAgICBjb25zdCBzZWxlY3RlZEtleXMgPSB0aGlzLmdldFNlbGVjdGVkS2V5cyhyb290S2V5KTtcbiAgICAvKlxuICAgICAqIE5vdGU6IFRoaXMgZG9lcyBub3QgY2FsbCBgZ2V0U2VsZWN0ZWROb2Rlc2AgdG8gcHJldmVudCBjcmVhdGluZyBub2RlcyB0aGF0IHdvdWxkIGJlIHRocm93blxuICAgICAqIGF3YXkgaWYgdGhlcmUgaXMgbW9yZSB0aGFuIDEgc2VsZWN0ZWQgbm9kZS5cbiAgICAgKi9cbiAgICByZXR1cm4gKHNlbGVjdGVkS2V5cy5zaXplID09PSAxKSA/IHRoaXMuZ2V0Tm9kZShyb290S2V5LCBzZWxlY3RlZEtleXMuZmlyc3QoKSkgOiBudWxsO1xuICB9XG5cbiAgZ2V0Um9vdE5vZGUocm9vdEtleTogc3RyaW5nKTogRmlsZVRyZWVOb2RlIHtcbiAgICByZXR1cm4gdGhpcy5nZXROb2RlKHJvb3RLZXksIHJvb3RLZXkpO1xuICB9XG5cbiAgZ2V0Tm9kZShyb290S2V5OiBzdHJpbmcsIG5vZGVLZXk6IHN0cmluZyk6IEZpbGVUcmVlTm9kZSB7XG4gICAgcmV0dXJuIG5ldyBGaWxlVHJlZU5vZGUodGhpcywgcm9vdEtleSwgbm9kZUtleSk7XG4gIH1cblxuICAvKipcbiAgICogSWYgYSBmZXRjaCBpcyBub3QgYWxyZWFkeSBpbiBwcm9ncmVzcyBpbml0aWF0ZSBhIGZldGNoIG5vdy5cbiAgICovXG4gIF9mZXRjaENoaWxkS2V5cyhub2RlS2V5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBleGlzdGluZ1Byb21pc2UgPSB0aGlzLl9nZXRMb2FkaW5nKG5vZGVLZXkpO1xuICAgIGlmIChleGlzdGluZ1Byb21pc2UpIHtcbiAgICAgIHJldHVybiBleGlzdGluZ1Byb21pc2U7XG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IEZpbGVUcmVlSGVscGVycy5mZXRjaENoaWxkcmVuKG5vZGVLZXkpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5fbG9nZ2VyLmVycm9yKGBVbmFibGUgdG8gZmV0Y2ggY2hpbGRyZW4gZm9yIFwiJHtub2RlS2V5fVwiLmApO1xuICAgICAgdGhpcy5fbG9nZ2VyLmVycm9yKCdPcmlnaW5hbCBlcnJvcjogJywgZXJyb3IpO1xuICAgICAgLy8gQ29sbGFwc2UgdGhlIG5vZGUgYW5kIGNsZWFyIGl0cyBsb2FkaW5nIHN0YXRlIG9uIGVycm9yIHNvIHRoZSB1c2VyIGNhbiByZXRyeSBleHBhbmRpbmcgaXQuXG4gICAgICBjb25zdCByb290S2V5ID0gdGhpcy5nZXRSb290Rm9yS2V5KG5vZGVLZXkpO1xuICAgICAgaWYgKHJvb3RLZXkgIT0gbnVsbCkge1xuICAgICAgICB0aGlzLl9jb2xsYXBzZU5vZGUocm9vdEtleSwgbm9kZUtleSk7XG4gICAgICB9XG4gICAgICB0aGlzLl9jbGVhckxvYWRpbmcobm9kZUtleSk7XG4gICAgfSkudGhlbihjaGlsZEtleXMgPT4ge1xuICAgICAgLy8gSWYgdGhpcyBub2RlJ3Mgcm9vdCB3ZW50IGF3YXkgd2hpbGUgdGhlIFByb21pc2Ugd2FzIHJlc29sdmluZywgZG8gbm8gbW9yZSB3b3JrLiBUaGlzIG5vZGVcbiAgICAgIC8vIGlzIG5vIGxvbmdlciBuZWVkZWQgaW4gdGhlIHN0b3JlLlxuICAgICAgaWYgKHRoaXMuZ2V0Um9vdEZvcktleShub2RlS2V5KSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3NldENoaWxkS2V5cyhub2RlS2V5LCBjaGlsZEtleXMpO1xuICAgICAgdGhpcy5fYWRkU3Vic2NyaXB0aW9uKG5vZGVLZXkpO1xuICAgICAgdGhpcy5fY2xlYXJMb2FkaW5nKG5vZGVLZXkpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5fc2V0TG9hZGluZyhub2RlS2V5LCBwcm9taXNlKTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIF9nZXRMb2FkaW5nKG5vZGVLZXk6IHN0cmluZyk6ID9Qcm9taXNlIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YS5pc0xvYWRpbmdNYXBbbm9kZUtleV07XG4gIH1cblxuICBfc2V0TG9hZGluZyhub2RlS2V5OiBzdHJpbmcsIHZhbHVlOiBQcm9taXNlKTogdm9pZCB7XG4gICAgdGhpcy5fc2V0KCdpc0xvYWRpbmdNYXAnLCBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLmlzTG9hZGluZ01hcCwgbm9kZUtleSwgdmFsdWUpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgdGhlIG5vZGUgdG8gYmUga2VwdCBpbiB2aWV3IGlmIG5vIG1vcmUgZGF0YSBpcyBiZWluZyBhd2FpdGVkLiBTYWZlIHRvIGNhbGwgbWFueSB0aW1lc1xuICAgKiBiZWNhdXNlIGl0IG9ubHkgY2hhbmdlcyBzdGF0ZSBpZiBhIG5vZGUgaXMgYmVpbmcgdHJhY2tlZC5cbiAgICovXG4gIF9jaGVja1RyYWNrZWROb2RlKCk6IHZvaWQge1xuICAgIGlmIChcbiAgICAgIHRoaXMuX2RhdGEudHJhY2tlZE5vZGUgIT0gbnVsbCAmJlxuICAgICAgLypcbiAgICAgICAqIFRoZSBsb2FkaW5nIG1hcCBiZWluZyBlbXB0eSBpcyBhIGhldXJpc3RpYyBmb3Igd2hlbiBsb2FkaW5nIGhhcyBjb21wbGV0ZWQuIEl0IGlzIGluZXhhY3RcbiAgICAgICAqIGJlY2F1c2UgdGhlIGxvYWRpbmcgbWlnaHQgYmUgdW5yZWxhdGVkIHRvIHRoZSB0cmFja2VkIG5vZGUsIGhvd2V2ZXIgaXQgaXMgY2hlYXAgYW5kIGZhbHNlXG4gICAgICAgKiBwb3NpdGl2ZXMgd2lsbCBvbmx5IGxhc3QgdW50aWwgbG9hZGluZyBpcyBjb21wbGV0ZSBvciB1bnRpbCB0aGUgdXNlciBjbGlja3MgYW5vdGhlciBub2RlIGluXG4gICAgICAgKiB0aGUgdHJlZS5cbiAgICAgICAqL1xuICAgICAgb2JqZWN0VXRpbC5pc0VtcHR5KHRoaXMuX2RhdGEuaXNMb2FkaW5nTWFwKVxuICAgICkge1xuICAgICAgLy8gTG9hZGluZyBoYXMgY29tcGxldGVkLiBBbGxvdyBzY3JvbGxpbmcgdG8gcHJvY2VlZCBhcyB1c3VhbC5cbiAgICAgIHRoaXMuX3NldCgndHJhY2tlZE5vZGUnLCBudWxsKTtcbiAgICB9XG4gIH1cblxuICBfY2xlYXJMb2FkaW5nKG5vZGVLZXk6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuX3NldCgnaXNMb2FkaW5nTWFwJywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5pc0xvYWRpbmdNYXAsIG5vZGVLZXkpKTtcbiAgICB0aGlzLl9jaGVja1RyYWNrZWROb2RlKCk7XG4gIH1cblxuICBfZGVsZXRlU2VsZWN0ZWROb2RlcygpOiB2b2lkIHtcbiAgICBjb25zdCBzZWxlY3RlZE5vZGVzID0gdGhpcy5nZXRTZWxlY3RlZE5vZGVzKCk7XG4gICAgc2VsZWN0ZWROb2Rlcy5mb3JFYWNoKG5vZGUgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IEZpbGVUcmVlSGVscGVycy5nZXRGaWxlQnlLZXkobm9kZS5ub2RlS2V5KTtcbiAgICAgIGlmIChmaWxlICE9IG51bGwpIHtcbiAgICAgICAgaWYgKEZpbGVUcmVlSGVscGVycy5pc0xvY2FsRmlsZShmaWxlKSkge1xuICAgICAgICAgIC8vIFRPRE86IFRoaXMgc3BlY2lhbC1jYXNlIGNhbiBiZSBlbGltaW5hdGVkIG9uY2UgYGRlbGV0ZSgpYCBpcyBhZGRlZCB0byBgRGlyZWN0b3J5YFxuICAgICAgICAgIC8vIGFuZCBgRmlsZWAuXG4gICAgICAgICAgc2hlbGwubW92ZUl0ZW1Ub1RyYXNoKG5vZGUubm9kZVBhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICgoZmlsZTogYW55KTogKFJlbW90ZURpcmVjdG9yeSB8IFJlbW90ZUZpbGUpKS5kZWxldGUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgX2V4cGFuZE5vZGUocm9vdEtleTogc3RyaW5nLCBub2RlS2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLl9zZXRFeHBhbmRlZEtleXMocm9vdEtleSwgdGhpcy5fZ2V0RXhwYW5kZWRLZXlzKHJvb3RLZXkpLmFkZChub2RlS2V5KSk7XG4gICAgLy8gSWYgd2UgaGF2ZSBjaGlsZCBub2RlcyB0aGF0IHNob3VsZCBhbHNvIGJlIGV4cGFuZGVkLCBleHBhbmQgdGhlbSBub3cuXG4gICAgbGV0IHByZXZpb3VzbHlFeHBhbmRlZCA9IHRoaXMuX2dldFByZXZpb3VzbHlFeHBhbmRlZChyb290S2V5KTtcbiAgICBpZiAocHJldmlvdXNseUV4cGFuZGVkLmhhcyhub2RlS2V5KSkge1xuICAgICAgZm9yIChjb25zdCBjaGlsZEtleSBvZiBwcmV2aW91c2x5RXhwYW5kZWQuZ2V0KG5vZGVLZXkpKSB7XG4gICAgICAgIHRoaXMuX2V4cGFuZE5vZGUocm9vdEtleSwgY2hpbGRLZXkpO1xuICAgICAgfVxuICAgICAgLy8gQ2xlYXIgdGhlIHByZXZpb3VzbHlFeHBhbmRlZCBsaXN0IHNpbmNlIHdlJ3JlIGRvbmUgd2l0aCBpdC5cbiAgICAgIHByZXZpb3VzbHlFeHBhbmRlZCA9IHByZXZpb3VzbHlFeHBhbmRlZC5kZWxldGUobm9kZUtleSk7XG4gICAgICB0aGlzLl9zZXRQcmV2aW91c2x5RXhwYW5kZWQocm9vdEtleSwgcHJldmlvdXNseUV4cGFuZGVkKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybWVzIGEgZGVlcCBCRlMgc2Nhbm5pbmcgZXhwYW5kIG9mIGNvbnRhaW5lZCBub2Rlcy5cbiAgICogcmV0dXJucyAtIGEgcHJvbWlzZSBmdWxmaWxsZWQgd2hlbiB0aGUgZXhwYW5kIG9wZXJhdGlvbiBpcyBmaW5pc2hlZFxuICAgKi9cbiAgX2V4cGFuZE5vZGVEZWVwKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gU3RvcCB0aGUgdHJhdmVyc2FsIGFmdGVyIDEwMCBub2RlcyB3ZXJlIGFkZGVkIHRvIHRoZSB0cmVlXG4gICAgY29uc3QgaXROb2RlcyA9IG5ldyBGaWxlVHJlZVN0b3JlQmZzSXRlcmF0b3IodGhpcywgcm9vdEtleSwgbm9kZUtleSwgLyogbGltaXQqLyAxMDApO1xuICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgZXhwYW5kID0gKCkgPT4ge1xuICAgICAgICBjb25zdCB0cmF2ZXJzZWROb2RlS2V5ID0gaXROb2Rlcy50cmF2ZXJzZWROb2RlKCk7XG4gICAgICAgIGlmICh0cmF2ZXJzZWROb2RlS2V5KSB7XG4gICAgICAgICAgdGhpcy5fc2V0RXhwYW5kZWRLZXlzKHJvb3RLZXksIHRoaXMuX2dldEV4cGFuZGVkS2V5cyhyb290S2V5KS5hZGQodHJhdmVyc2VkTm9kZUtleSkpO1xuICAgICAgICAgIC8qKlxuICAgICAgICAgICAqIEV2ZW4gaWYgdGhlcmUgd2VyZSBwcmV2aW91c2x5IGV4cGFuZGVkIG5vZGVzIGl0IGRvZXNuJ3QgbWF0dGVyIGFzXG4gICAgICAgICAgICogd2UnbGwgZXhwYW5kIGFsbCBvZiB0aGUgY2hpbGRyZW4uXG4gICAgICAgICAgICovXG4gICAgICAgICAgbGV0IHByZXZpb3VzbHlFeHBhbmRlZCA9IHRoaXMuX2dldFByZXZpb3VzbHlFeHBhbmRlZChyb290S2V5KTtcbiAgICAgICAgICBwcmV2aW91c2x5RXhwYW5kZWQgPSBwcmV2aW91c2x5RXhwYW5kZWQuZGVsZXRlKHRyYXZlcnNlZE5vZGVLZXkpO1xuICAgICAgICAgIHRoaXMuX3NldFByZXZpb3VzbHlFeHBhbmRlZChyb290S2V5LCBwcmV2aW91c2x5RXhwYW5kZWQpO1xuXG4gICAgICAgICAgY29uc3QgbmV4dFByb21pc2UgPSBpdE5vZGVzLm5leHQoKTtcbiAgICAgICAgICBpZiAobmV4dFByb21pc2UpIHtcbiAgICAgICAgICAgIG5leHRQcm9taXNlLnRoZW4oZXhwYW5kKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBleHBhbmQoKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFdoZW4gd2UgY29sbGFwc2UgYSBub2RlIHdlIG5lZWQgdG8gZG8gc29tZSBjbGVhbnVwIHJlbW92aW5nIHN1YnNjcmlwdGlvbnMgYW5kIHNlbGVjdGlvbi5cbiAgICovXG4gIF9jb2xsYXBzZU5vZGUocm9vdEtleTogc3RyaW5nLCBub2RlS2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBjaGlsZEtleXMgPSB0aGlzLl9kYXRhLmNoaWxkS2V5TWFwW25vZGVLZXldO1xuICAgIGxldCBzZWxlY3RlZEtleXMgPSB0aGlzLl9kYXRhLnNlbGVjdGVkS2V5c0J5Um9vdFtyb290S2V5XTtcbiAgICBjb25zdCBleHBhbmRlZENoaWxkS2V5cyA9IFtdO1xuICAgIGlmIChjaGlsZEtleXMpIHtcbiAgICAgIGNoaWxkS2V5cy5mb3JFYWNoKChjaGlsZEtleSkgPT4ge1xuICAgICAgICAvLyBVbnNlbGVjdCBlYWNoIGNoaWxkLlxuICAgICAgICBpZiAoc2VsZWN0ZWRLZXlzICYmIHNlbGVjdGVkS2V5cy5oYXMoY2hpbGRLZXkpKSB7XG4gICAgICAgICAgc2VsZWN0ZWRLZXlzID0gc2VsZWN0ZWRLZXlzLmRlbGV0ZShjaGlsZEtleSk7XG4gICAgICAgICAgLypcbiAgICAgICAgICAgKiBTZXQgdGhlIHNlbGVjdGVkIGtleXMgKmJlZm9yZSogdGhlIHJlY3Vyc2l2ZSBgX2NvbGxhcHNlTm9kZWAgY2FsbCBzbyBlYWNoIGNhbGwgc3RvcmVzXG4gICAgICAgICAgICogaXRzIGNoYW5nZXMgYW5kIGlzbid0IHdpcGVkIG91dCBieSB0aGUgbmV4dCBjYWxsIGJ5IGtlZXBpbmcgYW4gb3V0ZGF0ZWQgYHNlbGVjdGVkS2V5c2BcbiAgICAgICAgICAgKiBpbiB0aGUgY2FsbCBzdGFjay5cbiAgICAgICAgICAgKi9cbiAgICAgICAgICB0aGlzLl9zZXRTZWxlY3RlZEtleXMocm9vdEtleSwgc2VsZWN0ZWRLZXlzKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBDb2xsYXBzZSBlYWNoIGNoaWxkIGRpcmVjdG9yeS5cbiAgICAgICAgaWYgKEZpbGVUcmVlSGVscGVycy5pc0RpcktleShjaGlsZEtleSkpIHtcbiAgICAgICAgICBpZiAodGhpcy5pc0V4cGFuZGVkKHJvb3RLZXksIGNoaWxkS2V5KSkge1xuICAgICAgICAgICAgZXhwYW5kZWRDaGlsZEtleXMucHVzaChjaGlsZEtleSk7XG4gICAgICAgICAgICB0aGlzLl9jb2xsYXBzZU5vZGUocm9vdEtleSwgY2hpbGRLZXkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIC8qXG4gICAgICogU2F2ZSB0aGUgbGlzdCBvZiBleHBhbmRlZCBjaGlsZCBub2RlcyBzbyBuZXh0IHRpbWUgd2UgZXhwYW5kIHRoaXMgbm9kZSB3ZSBjYW4gZXhwYW5kIHRoZXNlXG4gICAgICogY2hpbGRyZW4uXG4gICAgICovXG4gICAgbGV0IHByZXZpb3VzbHlFeHBhbmRlZCA9IHRoaXMuX2dldFByZXZpb3VzbHlFeHBhbmRlZChyb290S2V5KTtcbiAgICBpZiAoZXhwYW5kZWRDaGlsZEtleXMubGVuZ3RoICE9PSAwKSB7XG4gICAgICBwcmV2aW91c2x5RXhwYW5kZWQgPSBwcmV2aW91c2x5RXhwYW5kZWQuc2V0KG5vZGVLZXksIGV4cGFuZGVkQ2hpbGRLZXlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcHJldmlvdXNseUV4cGFuZGVkID0gcHJldmlvdXNseUV4cGFuZGVkLmRlbGV0ZShub2RlS2V5KTtcbiAgICB9XG4gICAgdGhpcy5fc2V0UHJldmlvdXNseUV4cGFuZGVkKHJvb3RLZXksIHByZXZpb3VzbHlFeHBhbmRlZCk7XG4gICAgdGhpcy5fc2V0RXhwYW5kZWRLZXlzKHJvb3RLZXksIHRoaXMuX2dldEV4cGFuZGVkS2V5cyhyb290S2V5KS5kZWxldGUobm9kZUtleSkpO1xuICAgIHRoaXMuX3JlbW92ZVN1YnNjcmlwdGlvbihyb290S2V5LCBub2RlS2V5KTtcbiAgfVxuXG4gIF9nZXRQcmV2aW91c2x5RXhwYW5kZWQocm9vdEtleTogc3RyaW5nKTogSW1tdXRhYmxlLk1hcDxzdHJpbmcsIEFycmF5PHN0cmluZz4+IHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YS5wcmV2aW91c2x5RXhwYW5kZWRbcm9vdEtleV0gfHwgbmV3IEltbXV0YWJsZS5NYXAoKTtcbiAgfVxuXG4gIF9zZXRQcmV2aW91c2x5RXhwYW5kZWQocm9vdEtleTogc3RyaW5nLFxuICAgIHByZXZpb3VzbHlFeHBhbmRlZDogSW1tdXRhYmxlLk1hcDxzdHJpbmcsIEFycmF5PHN0cmluZz4+KTogdm9pZCB7XG4gICAgdGhpcy5fc2V0KFxuICAgICAgJ3ByZXZpb3VzbHlFeHBhbmRlZCcsXG4gICAgICBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLnByZXZpb3VzbHlFeHBhbmRlZCwgcm9vdEtleSwgcHJldmlvdXNseUV4cGFuZGVkKVxuICAgICk7XG4gIH1cblxuICBfZ2V0RXhwYW5kZWRLZXlzKHJvb3RLZXk6IHN0cmluZyk6IEltbXV0YWJsZS5TZXQ8c3RyaW5nPiB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGEuZXhwYW5kZWRLZXlzQnlSb290W3Jvb3RLZXldIHx8IG5ldyBJbW11dGFibGUuU2V0KCk7XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBpcyBqdXN0IGV4cG9zZWQgc28gaXQgY2FuIGJlIG1vY2tlZCBpbiB0aGUgdGVzdHMuIE5vdCBpZGVhbCwgYnV0IGEgbG90IGxlc3MgbWVzc3kgdGhhbiB0aGVcbiAgICogYWx0ZXJuYXRpdmVzLiBGb3IgZXhhbXBsZSwgcGFzc2luZyBvcHRpb25zIHdoZW4gY29uc3RydWN0aW5nIGFuIGluc3RhbmNlIG9mIGEgc2luZ2xldG9uIHdvdWxkXG4gICAqIG1ha2UgZnV0dXJlIGludm9jYXRpb25zIG9mIGBnZXRJbnN0YW5jZWAgdW5wcmVkaWN0YWJsZS5cbiAgICovXG4gIF9yZXBvc2l0b3J5Rm9yUGF0aChwYXRoOiBOdWNsaWRlVXJpKTogP2F0b20kUmVwb3NpdG9yeSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UmVwb3NpdG9yaWVzKCkuZmluZChyZXBvID0+IHJlcG9zaXRvcnlDb250YWluc1BhdGgocmVwbywgcGF0aCkpO1xuICB9XG5cbiAgX3NldEV4cGFuZGVkS2V5cyhyb290S2V5OiBzdHJpbmcsIGV4cGFuZGVkS2V5czogSW1tdXRhYmxlLlNldDxzdHJpbmc+KTogdm9pZCB7XG4gICAgdGhpcy5fc2V0KFxuICAgICAgJ2V4cGFuZGVkS2V5c0J5Um9vdCcsXG4gICAgICBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLmV4cGFuZGVkS2V5c0J5Um9vdCwgcm9vdEtleSwgZXhwYW5kZWRLZXlzKVxuICAgICk7XG4gIH1cblxuICBfZGVsZXRlU2VsZWN0ZWRLZXlzKHJvb3RLZXk6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuX3NldCgnc2VsZWN0ZWRLZXlzQnlSb290JywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5zZWxlY3RlZEtleXNCeVJvb3QsIHJvb3RLZXkpKTtcbiAgfVxuXG4gIF9zZXRTZWxlY3RlZEtleXMocm9vdEtleTogc3RyaW5nLCBzZWxlY3RlZEtleXM6IEltbXV0YWJsZS5PcmRlcmVkU2V0PHN0cmluZz4pOiB2b2lkIHtcbiAgICAvKlxuICAgICAqIE5ldyBzZWxlY3Rpb24gbWVhbnMgcHJldmlvdXMgbm9kZSBzaG91bGQgbm90IGJlIGtlcHQgaW4gdmlldy4gRG8gdGhpcyB3aXRob3V0IGRlLWJvdW5jaW5nXG4gICAgICogYmVjYXVzZSB0aGUgcHJldmlvdXMgc3RhdGUgaXMgaXJyZWxldmFudC4gSWYgdGhlIHVzZXIgY2hvc2UgYSBuZXcgc2VsZWN0aW9uLCB0aGUgcHJldmlvdXMgb25lXG4gICAgICogc2hvdWxkIG5vdCBiZSBzY3JvbGxlZCBpbnRvIHZpZXcuXG4gICAgICovXG4gICAgdGhpcy5fc2V0KCd0cmFja2VkTm9kZScsIG51bGwpO1xuICAgIHRoaXMuX3NldChcbiAgICAgICdzZWxlY3RlZEtleXNCeVJvb3QnLFxuICAgICAgc2V0UHJvcGVydHkodGhpcy5fZGF0YS5zZWxlY3RlZEtleXNCeVJvb3QsIHJvb3RLZXksIHNlbGVjdGVkS2V5cylcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHNlbGVjdGVkIGtleXMgaW4gYWxsIHJvb3RzIG9mIHRoZSB0cmVlLiBUaGUgc2VsZWN0ZWQga2V5cyBvZiByb290IGtleXMgbm90IGluXG4gICAqIGBzZWxlY3RlZEtleXNCeVJvb3RgIGFyZSBkZWxldGVkICh0aGUgcm9vdCBpcyBsZWZ0IHdpdGggbm8gc2VsZWN0aW9uKS5cbiAgICovXG4gIF9zZXRTZWxlY3RlZEtleXNCeVJvb3Qoc2VsZWN0ZWRLZXlzQnlSb290OiB7W2tleTogc3RyaW5nXTogSW1tdXRhYmxlLk9yZGVyZWRTZXQ8c3RyaW5nPn0pOiB2b2lkIHtcbiAgICB0aGlzLmdldFJvb3RLZXlzKCkuZm9yRWFjaChyb290S2V5ID0+IHtcbiAgICAgIGlmIChzZWxlY3RlZEtleXNCeVJvb3QuaGFzT3duUHJvcGVydHkocm9vdEtleSkpIHtcbiAgICAgICAgdGhpcy5fc2V0U2VsZWN0ZWRLZXlzKHJvb3RLZXksIHNlbGVjdGVkS2V5c0J5Um9vdFtyb290S2V5XSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9kZWxldGVTZWxlY3RlZEtleXMocm9vdEtleSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBfc2V0Um9vdEtleXMocm9vdEtleXM6IEFycmF5PHN0cmluZz4pOiB2b2lkIHtcbiAgICBjb25zdCBvbGRSb290S2V5cyA9IHRoaXMuX2RhdGEucm9vdEtleXM7XG4gICAgY29uc3QgbmV3Um9vdEtleXMgPSBuZXcgSW1tdXRhYmxlLlNldChyb290S2V5cyk7XG4gICAgY29uc3QgcmVtb3ZlZFJvb3RLZXlzID0gbmV3IEltbXV0YWJsZS5TZXQob2xkUm9vdEtleXMpLnN1YnRyYWN0KG5ld1Jvb3RLZXlzKTtcbiAgICByZW1vdmVkUm9vdEtleXMuZm9yRWFjaCh0aGlzLl9wdXJnZVJvb3QuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5fc2V0KCdyb290S2V5cycsIHJvb3RLZXlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgc2luZ2xlIGNoaWxkIG5vZGUuIEl0J3MgdXNlZnVsIHdoZW4gZXhwYW5kaW5nIHRvIGEgZGVlcGx5IG5lc3RlZCBub2RlLlxuICAgKi9cbiAgX2NyZWF0ZUNoaWxkKG5vZGVLZXk6IHN0cmluZywgY2hpbGRLZXk6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuX3NldENoaWxkS2V5cyhub2RlS2V5LCBbY2hpbGRLZXldKTtcbiAgICAvKlxuICAgICAqIE1hcmsgdGhlIG5vZGUgYXMgZGlydHkgc28gaXRzIGFuY2VzdG9ycyBhcmUgZmV0Y2hlZCBhZ2FpbiBvbiByZWxvYWQgb2YgdGhlIHRyZWUuXG4gICAgICovXG4gICAgdGhpcy5fc2V0KCdpc0RpcnR5TWFwJywgc2V0UHJvcGVydHkodGhpcy5fZGF0YS5pc0RpcnR5TWFwLCBub2RlS2V5LCB0cnVlKSk7XG4gIH1cblxuICBfc2V0Q2hpbGRLZXlzKG5vZGVLZXk6IHN0cmluZywgY2hpbGRLZXlzOiBBcnJheTxzdHJpbmc+KTogdm9pZCB7XG4gICAgY29uc3Qgb2xkQ2hpbGRLZXlzID0gdGhpcy5fZGF0YS5jaGlsZEtleU1hcFtub2RlS2V5XTtcbiAgICBpZiAob2xkQ2hpbGRLZXlzKSB7XG4gICAgICBjb25zdCBuZXdDaGlsZEtleXMgPSBuZXcgSW1tdXRhYmxlLlNldChjaGlsZEtleXMpO1xuICAgICAgY29uc3QgcmVtb3ZlZERpcmVjdG9yeUtleXMgPSBuZXcgSW1tdXRhYmxlLlNldChvbGRDaGlsZEtleXMpXG4gICAgICAgIC5zdWJ0cmFjdChuZXdDaGlsZEtleXMpXG4gICAgICAgIC5maWx0ZXIoRmlsZVRyZWVIZWxwZXJzLmlzRGlyS2V5KTtcbiAgICAgIHJlbW92ZWREaXJlY3RvcnlLZXlzLmZvckVhY2godGhpcy5fcHVyZ2VEaXJlY3RvcnkuYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIHRoaXMuX3NldCgnY2hpbGRLZXlNYXAnLCBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLmNoaWxkS2V5TWFwLCBub2RlS2V5LCBjaGlsZEtleXMpKTtcbiAgfVxuXG4gIF9vbkRpcmVjdG9yeUNoYW5nZShub2RlS2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLl9mZXRjaENoaWxkS2V5cyhub2RlS2V5KTtcbiAgfVxuXG4gIF9hZGRTdWJzY3JpcHRpb24obm9kZUtleTogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZGlyZWN0b3J5ID0gRmlsZVRyZWVIZWxwZXJzLmdldERpcmVjdG9yeUJ5S2V5KG5vZGVLZXkpO1xuICAgIGlmICghZGlyZWN0b3J5KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLypcbiAgICAgKiBSZW1vdmUgdGhlIGRpcmVjdG9yeSdzIGRpcnR5IG1hcmtlciByZWdhcmRsZXNzIG9mIHdoZXRoZXIgYSBzdWJzY3JpcHRpb24gYWxyZWFkeSBleGlzdHNcbiAgICAgKiBiZWNhdXNlIHRoZXJlIGlzIG5vdGhpbmcgZnVydGhlciBtYWtpbmcgaXQgZGlydHkuXG4gICAgICovXG4gICAgdGhpcy5fc2V0KCdpc0RpcnR5TWFwJywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5pc0RpcnR5TWFwLCBub2RlS2V5KSk7XG5cbiAgICAvLyBEb24ndCBjcmVhdGUgYSBuZXcgc3Vic2NyaXB0aW9uIGlmIG9uZSBhbHJlYWR5IGV4aXN0cy5cbiAgICBpZiAodGhpcy5fZGF0YS5zdWJzY3JpcHRpb25NYXBbbm9kZUtleV0pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgc3Vic2NyaXB0aW9uO1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGlzIGNhbGwgbWlnaHQgZmFpbCBpZiB3ZSB0cnkgdG8gd2F0Y2ggYSBub24tZXhpc3RpbmcgZGlyZWN0b3J5LCBvciBpZiBwZXJtaXNzaW9uIGRlbmllZC5cbiAgICAgIHN1YnNjcmlwdGlvbiA9IGRpcmVjdG9yeS5vbkRpZENoYW5nZSgoKSA9PiB7XG4gICAgICAgIHRoaXMuX29uRGlyZWN0b3J5Q2hhbmdlKG5vZGVLZXkpO1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIC8qXG4gICAgICAgKiBMb2cgZXJyb3IgYW5kIG1hcmsgdGhlIGRpcmVjdG9yeSBhcyBkaXJ0eSBzbyB0aGUgZmFpbGVkIHN1YnNjcmlwdGlvbiB3aWxsIGJlIGF0dGVtcHRlZFxuICAgICAgICogYWdhaW4gbmV4dCB0aW1lIHRoZSBkaXJlY3RvcnkgaXMgZXhwYW5kZWQuXG4gICAgICAgKi9cbiAgICAgIHRoaXMuX2xvZ2dlci5lcnJvcihgQ2Fubm90IHN1YnNjcmliZSB0byBkaXJlY3RvcnkgXCIke25vZGVLZXl9XCJgLCBleCk7XG4gICAgICB0aGlzLl9zZXQoJ2lzRGlydHlNYXAnLCBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLmlzRGlydHlNYXAsIG5vZGVLZXkpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5fc2V0KCdzdWJzY3JpcHRpb25NYXAnLCBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLnN1YnNjcmlwdGlvbk1hcCwgbm9kZUtleSwgc3Vic2NyaXB0aW9uKSk7XG4gIH1cblxuICBfcmVtb3ZlU3Vic2NyaXB0aW9uKHJvb3RLZXk6IHN0cmluZywgbm9kZUtleTogc3RyaW5nKTogdm9pZCB7XG4gICAgbGV0IGhhc1JlbWFpbmluZ1N1YnNjcmliZXJzO1xuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHRoaXMuX2RhdGEuc3Vic2NyaXB0aW9uTWFwW25vZGVLZXldO1xuXG4gICAgaWYgKHN1YnNjcmlwdGlvbiAhPSBudWxsKSB7XG4gICAgICBoYXNSZW1haW5pbmdTdWJzY3JpYmVycyA9IHRoaXMuX2RhdGEucm9vdEtleXMuc29tZSgob3RoZXJSb290S2V5KSA9PiAoXG4gICAgICAgIG90aGVyUm9vdEtleSAhPT0gcm9vdEtleSAmJiB0aGlzLmlzRXhwYW5kZWQob3RoZXJSb290S2V5LCBub2RlS2V5KVxuICAgICAgKSk7XG4gICAgICBpZiAoIWhhc1JlbWFpbmluZ1N1YnNjcmliZXJzKSB7XG4gICAgICAgIHN1YnNjcmlwdGlvbi5kaXNwb3NlKCk7XG4gICAgICAgIHRoaXMuX3NldCgnc3Vic2NyaXB0aW9uTWFwJywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5zdWJzY3JpcHRpb25NYXAsIG5vZGVLZXkpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3Vic2NyaXB0aW9uID09IG51bGwgfHwgaGFzUmVtYWluaW5nU3Vic2NyaWJlcnMgPT09IGZhbHNlKSB7XG4gICAgICAvLyBTaW5jZSB3ZSdyZSBubyBsb25nZXIgZ2V0dGluZyBub3RpZmljYXRpb25zIHdoZW4gdGhlIGRpcmVjdG9yeSBjb250ZW50cyBjaGFuZ2UsIGFzc3VtZSB0aGVcbiAgICAgIC8vIGNoaWxkIGxpc3QgaXMgZGlydHkuXG4gICAgICB0aGlzLl9zZXQoJ2lzRGlydHlNYXAnLCBzZXRQcm9wZXJ0eSh0aGlzLl9kYXRhLmlzRGlydHlNYXAsIG5vZGVLZXksIHRydWUpKTtcbiAgICB9XG4gIH1cblxuICBfcmVtb3ZlQWxsU3Vic2NyaXB0aW9ucyhub2RlS2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBzdWJzY3JpcHRpb24gPSB0aGlzLl9kYXRhLnN1YnNjcmlwdGlvbk1hcFtub2RlS2V5XTtcbiAgICBpZiAoc3Vic2NyaXB0aW9uKSB7XG4gICAgICBzdWJzY3JpcHRpb24uZGlzcG9zZSgpO1xuICAgICAgdGhpcy5fc2V0KCdzdWJzY3JpcHRpb25NYXAnLCBkZWxldGVQcm9wZXJ0eSh0aGlzLl9kYXRhLnN1YnNjcmlwdGlvbk1hcCwgbm9kZUtleSkpO1xuICAgIH1cbiAgfVxuXG4gIF9wdXJnZU5vZGUocm9vdEtleTogc3RyaW5nLCBub2RlS2V5OiBzdHJpbmcsIHVuc2VsZWN0OiBib29sZWFuKTogdm9pZCB7XG4gICAgY29uc3QgZXhwYW5kZWRLZXlzID0gdGhpcy5fZ2V0RXhwYW5kZWRLZXlzKHJvb3RLZXkpO1xuICAgIGlmIChleHBhbmRlZEtleXMuaGFzKG5vZGVLZXkpKSB7XG4gICAgICB0aGlzLl9zZXRFeHBhbmRlZEtleXMocm9vdEtleSwgZXhwYW5kZWRLZXlzLmRlbGV0ZShub2RlS2V5KSk7XG4gICAgfVxuXG4gICAgaWYgKHVuc2VsZWN0KSB7XG4gICAgICBjb25zdCBzZWxlY3RlZEtleXMgPSB0aGlzLmdldFNlbGVjdGVkS2V5cyhyb290S2V5KTtcbiAgICAgIGlmIChzZWxlY3RlZEtleXMuaGFzKG5vZGVLZXkpKSB7XG4gICAgICAgIHRoaXMuX3NldFNlbGVjdGVkS2V5cyhyb290S2V5LCBzZWxlY3RlZEtleXMuZGVsZXRlKG5vZGVLZXkpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c2x5RXhwYW5kZWQgPSB0aGlzLl9nZXRQcmV2aW91c2x5RXhwYW5kZWQocm9vdEtleSk7XG4gICAgaWYgKHByZXZpb3VzbHlFeHBhbmRlZC5oYXMobm9kZUtleSkpIHtcbiAgICAgIHRoaXMuX3NldFByZXZpb3VzbHlFeHBhbmRlZChyb290S2V5LCBwcmV2aW91c2x5RXhwYW5kZWQuZGVsZXRlKG5vZGVLZXkpKTtcbiAgICB9XG4gIH1cblxuICBfcHVyZ2VEaXJlY3RvcnlXaXRoaW5BUm9vdChyb290S2V5OiBzdHJpbmcsIG5vZGVLZXk6IHN0cmluZywgdW5zZWxlY3Q6IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBjb25zdCBjaGlsZEtleXMgPSB0aGlzLl9kYXRhLmNoaWxkS2V5TWFwW25vZGVLZXldO1xuICAgIGlmIChjaGlsZEtleXMpIHtcbiAgICAgIGNoaWxkS2V5cy5mb3JFYWNoKChjaGlsZEtleSkgPT4ge1xuICAgICAgICBpZiAoRmlsZVRyZWVIZWxwZXJzLmlzRGlyS2V5KGNoaWxkS2V5KSkge1xuICAgICAgICAgIHRoaXMuX3B1cmdlRGlyZWN0b3J5V2l0aGluQVJvb3Qocm9vdEtleSwgY2hpbGRLZXksIC8qIHVuc2VsZWN0ICovIHRydWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5fcmVtb3ZlU3Vic2NyaXB0aW9uKHJvb3RLZXksIG5vZGVLZXkpO1xuICAgIHRoaXMuX3B1cmdlTm9kZShyb290S2V5LCBub2RlS2V5LCB1bnNlbGVjdCk7XG4gIH1cblxuICAvLyBUaGlzIGlzIGNhbGxlZCB3aGVuIGEgZGlyY3RvcnkgaXMgcGh5c2ljYWxseSByZW1vdmVkIGZyb20gZGlzay4gV2hlbiB3ZSBwdXJnZSBhIGRpcmVjdG9yeSxcbiAgLy8gd2UgbmVlZCB0byBwdXJnZSBpdCdzIGNoaWxkIGRpcmVjdG9yaWVzIGFsc28uIFB1cmdpbmcgcmVtb3ZlcyBzdHVmZiBmcm9tIHRoZSBkYXRhIHN0b3JlXG4gIC8vIGluY2x1ZGluZyBsaXN0IG9mIGNoaWxkIG5vZGVzLCBzdWJzY3JpcHRpb25zLCBleHBhbmRlZCBkaXJlY3RvcmllcyBhbmQgc2VsZWN0ZWQgZGlyZWN0b3JpZXMuXG4gIF9wdXJnZURpcmVjdG9yeShub2RlS2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBjaGlsZEtleXMgPSB0aGlzLl9kYXRhLmNoaWxkS2V5TWFwW25vZGVLZXldO1xuICAgIGlmIChjaGlsZEtleXMpIHtcbiAgICAgIGNoaWxkS2V5cy5mb3JFYWNoKChjaGlsZEtleSkgPT4ge1xuICAgICAgICBpZiAoRmlsZVRyZWVIZWxwZXJzLmlzRGlyS2V5KGNoaWxkS2V5KSkge1xuICAgICAgICAgIHRoaXMuX3B1cmdlRGlyZWN0b3J5KGNoaWxkS2V5KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLl9zZXQoJ2NoaWxkS2V5TWFwJywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5jaGlsZEtleU1hcCwgbm9kZUtleSkpO1xuICAgIH1cblxuICAgIHRoaXMuX3JlbW92ZUFsbFN1YnNjcmlwdGlvbnMobm9kZUtleSk7XG4gICAgdGhpcy5nZXRSb290S2V5cygpLmZvckVhY2gocm9vdEtleSA9PiB7XG4gICAgICB0aGlzLl9wdXJnZU5vZGUocm9vdEtleSwgbm9kZUtleSwgLyogdW5zZWxlY3QgKi8gdHJ1ZSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBUT0RPOiBTaG91bGQgd2UgY2xlYW4gdXAgaXNMb2FkaW5nTWFwPyBJdCBjb250YWlucyBwcm9taXNlcyB3aGljaCBjYW5ub3QgYmUgY2FuY2VsbGVkLCBzbyB0aGlzXG4gIC8vIG1pZ2h0IGJlIHRyaWNreS5cbiAgX3B1cmdlUm9vdChyb290S2V5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBleHBhbmRlZEtleXMgPSB0aGlzLl9kYXRhLmV4cGFuZGVkS2V5c0J5Um9vdFtyb290S2V5XTtcbiAgICBpZiAoZXhwYW5kZWRLZXlzKSB7XG4gICAgICBleHBhbmRlZEtleXMuZm9yRWFjaCgobm9kZUtleSkgPT4ge1xuICAgICAgICB0aGlzLl9yZW1vdmVTdWJzY3JpcHRpb24ocm9vdEtleSwgbm9kZUtleSk7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuX3NldCgnZXhwYW5kZWRLZXlzQnlSb290JywgZGVsZXRlUHJvcGVydHkodGhpcy5fZGF0YS5leHBhbmRlZEtleXNCeVJvb3QsIHJvb3RLZXkpKTtcbiAgICB9XG4gICAgdGhpcy5fc2V0KCdzZWxlY3RlZEtleXNCeVJvb3QnLCBkZWxldGVQcm9wZXJ0eSh0aGlzLl9kYXRhLnNlbGVjdGVkS2V5c0J5Um9vdCwgcm9vdEtleSkpO1xuICAgIC8vIFJlbW92ZSBhbGwgY2hpbGQga2V5cyBzbyB0aGF0IG9uIHJlLWFkZGl0aW9uIG9mIHRoaXMgcm9vdCB0aGUgY2hpbGRyZW4gd2lsbCBiZSBmZXRjaGVkIGFnYWluLlxuICAgIGNvbnN0IGNoaWxkS2V5cyA9IHRoaXMuX2RhdGEuY2hpbGRLZXlNYXBbcm9vdEtleV07XG4gICAgaWYgKGNoaWxkS2V5cykge1xuICAgICAgY2hpbGRLZXlzLmZvckVhY2goKGNoaWxkS2V5KSA9PiB7XG4gICAgICAgIGlmIChGaWxlVHJlZUhlbHBlcnMuaXNEaXJLZXkoY2hpbGRLZXkpKSB7XG4gICAgICAgICAgdGhpcy5fc2V0KCdjaGlsZEtleU1hcCcsIGRlbGV0ZVByb3BlcnR5KHRoaXMuX2RhdGEuY2hpbGRLZXlNYXAsIGNoaWxkS2V5KSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhpcy5fc2V0KCdjaGlsZEtleU1hcCcsIGRlbGV0ZVByb3BlcnR5KHRoaXMuX2RhdGEuY2hpbGRLZXlNYXAsIHJvb3RLZXkpKTtcbiAgICB9XG4gICAgdGhpcy5fc2V0KCd2Y3NTdGF0dXNlc0J5Um9vdCcsIGRlbGV0ZVByb3BlcnR5KHRoaXMuX2RhdGEudmNzU3RhdHVzZXNCeVJvb3QsIHJvb3RLZXkpKTtcbiAgfVxuXG4gIF9zZXRUcmFja2VkTm9kZShyb290S2V5OiBzdHJpbmcsIG5vZGVLZXk6IHN0cmluZyk6IHZvaWQge1xuICAgIC8vIEZsdXNoIHRoZSB2YWx1ZSB0byBlbnN1cmUgY2xpZW50cyBzZWUgdGhlIHZhbHVlIGF0IGxlYXN0IG9uY2UgYW5kIHNjcm9sbCBhcHByb3ByaWF0ZWx5LlxuICAgIHRoaXMuX3NldCgndHJhY2tlZE5vZGUnLCB7bm9kZUtleSwgcm9vdEtleX0sIHRydWUpO1xuICB9XG5cbiAgX3NldFJlcG9zaXRvcmllcyhyZXBvc2l0b3JpZXM6IEltbXV0YWJsZS5TZXQ8YXRvbSRSZXBvc2l0b3J5Pik6IHZvaWQge1xuICAgIHRoaXMuX3NldCgncmVwb3NpdG9yaWVzJywgcmVwb3NpdG9yaWVzKTtcblxuICAgIC8vIFdoZW5ldmVyIGEgbmV3IHNldCBvZiByZXBvc2l0b3JpZXMgY29tZXMgaW4sIGludmFsaWRhdGUgb3VyIHBhdGhzIGNhY2hlIGJ5IHJlc2V0dGluZyBpdHNcbiAgICAvLyBgY2FjaGVgIHByb3BlcnR5IChjcmVhdGVkIGJ5IGxvZGFzaC5tZW1vaXplKSB0byBhbiBlbXB0eSBtYXAuXG4gICAgdGhpcy5fcmVwb3NpdG9yeUZvclBhdGguY2FjaGUgPSBuZXcgTWFwKCk7XG4gIH1cblxuICBfb21pdEhpZGRlblBhdGhzKG5vZGVLZXlzOiBBcnJheTxzdHJpbmc+KTogQXJyYXk8c3RyaW5nPiB7XG4gICAgaWYgKCF0aGlzLl9kYXRhLmhpZGVJZ25vcmVkTmFtZXMgJiYgIXRoaXMuX2RhdGEuZXhjbHVkZVZjc0lnbm9yZWRQYXRocykge1xuICAgICAgcmV0dXJuIG5vZGVLZXlzO1xuICAgIH1cblxuICAgIHJldHVybiBub2RlS2V5cy5maWx0ZXIobm9kZUtleSA9PiAhdGhpcy5fc2hvdWxkSGlkZVBhdGgobm9kZUtleSkpO1xuICB9XG5cbiAgX3Nob3VsZEhpZGVQYXRoKG5vZGVLZXk6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHtoaWRlSWdub3JlZE5hbWVzLCBleGNsdWRlVmNzSWdub3JlZFBhdGhzLCBpZ25vcmVkUGF0dGVybnN9ID0gdGhpcy5fZGF0YTtcbiAgICBpZiAoaGlkZUlnbm9yZWROYW1lcyAmJiBtYXRjaGVzU29tZShub2RlS2V5LCBpZ25vcmVkUGF0dGVybnMpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKGV4Y2x1ZGVWY3NJZ25vcmVkUGF0aHMgJiYgaXNWY3NJZ25vcmVkKG5vZGVLZXksIHRoaXMuX3JlcG9zaXRvcnlGb3JQYXRoKG5vZGVLZXkpKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJlc2V0KCk6IHZvaWQge1xuICAgIGNvbnN0IHN1YnNjcmlwdGlvbk1hcCA9IHRoaXMuX2RhdGEuc3Vic2NyaXB0aW9uTWFwO1xuICAgIGZvciAoY29uc3Qgbm9kZUtleSBvZiBPYmplY3Qua2V5cyhzdWJzY3JpcHRpb25NYXApKSB7XG4gICAgICBjb25zdCBzdWJzY3JpcHRpb24gPSBzdWJzY3JpcHRpb25NYXBbbm9kZUtleV07XG4gICAgICBpZiAoc3Vic2NyaXB0aW9uKSB7XG4gICAgICAgIHN1YnNjcmlwdGlvbi5kaXNwb3NlKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVzZXQgZGF0YSBzdG9yZS5cbiAgICB0aGlzLl9kYXRhID0gdGhpcy5fZ2V0RGVmYXVsdHMoKTtcbiAgfVxuXG4gIHN1YnNjcmliZShsaXN0ZW5lcjogQ2hhbmdlTGlzdGVuZXIpOiBEaXNwb3NhYmxlIHtcbiAgICByZXR1cm4gdGhpcy5fZW1pdHRlci5vbignY2hhbmdlJywgbGlzdGVuZXIpO1xuICB9XG59XG5cbi8vIEEgaGVscGVyIHRvIGRlbGV0ZSBhIHByb3BlcnR5IGluIGFuIG9iamVjdCB1c2luZyBzaGFsbG93IGNvcHkgcmF0aGVyIHRoYW4gbXV0YXRpb25cbmZ1bmN0aW9uIGRlbGV0ZVByb3BlcnR5KG9iamVjdDogT2JqZWN0LCBrZXk6IHN0cmluZyk6IE9iamVjdCB7XG4gIGlmICghb2JqZWN0Lmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICByZXR1cm4gb2JqZWN0O1xuICB9XG4gIGNvbnN0IG5ld09iamVjdCA9IHsuLi5vYmplY3R9O1xuICBkZWxldGUgbmV3T2JqZWN0W2tleV07XG4gIHJldHVybiBuZXdPYmplY3Q7XG59XG5cbi8vIEEgaGVscGVyIHRvIHNldCBhIHByb3BlcnR5IGluIGFuIG9iamVjdCB1c2luZyBzaGFsbG93IGNvcHkgcmF0aGVyIHRoYW4gbXV0YXRpb25cbmZ1bmN0aW9uIHNldFByb3BlcnR5KG9iamVjdDogT2JqZWN0LCBrZXk6IHN0cmluZywgbmV3VmFsdWU6IG1peGVkKTogT2JqZWN0IHtcbiAgY29uc3Qgb2xkVmFsdWUgPSBvYmplY3Rba2V5XTtcbiAgaWYgKG9sZFZhbHVlID09PSBuZXdWYWx1ZSkge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgY29uc3QgbmV3T2JqZWN0ID0gey4uLm9iamVjdH07XG4gIG5ld09iamVjdFtrZXldID0gbmV3VmFsdWU7XG4gIHJldHVybiBuZXdPYmplY3Q7XG59XG5cbi8vIENyZWF0ZSBhIG5ldyBvYmplY3QgYnkgbWFwcGluZyBvdmVyIHRoZSBwcm9wZXJ0aWVzIG9mIGEgZ2l2ZW4gb2JqZWN0LCBjYWxsaW5nIHRoZSBnaXZlblxuLy8gZnVuY3Rpb24gb24gZWFjaCBvbmUuXG5mdW5jdGlvbiBtYXBWYWx1ZXMob2JqZWN0OiBPYmplY3QsIGZuOiBGdW5jdGlvbik6IE9iamVjdCB7XG4gIGNvbnN0IG5ld09iamVjdCA9IHt9O1xuICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goKGtleSkgPT4ge1xuICAgIG5ld09iamVjdFtrZXldID0gZm4ob2JqZWN0W2tleV0sIGtleSk7XG4gIH0pO1xuICByZXR1cm4gbmV3T2JqZWN0O1xufVxuXG4vLyBEZXRlcm1pbmUgd2hldGhlciB0aGUgZ2l2ZW4gc3RyaW5nIG1hdGNoZXMgYW55IG9mIGEgc2V0IG9mIHBhdHRlcm5zLlxuZnVuY3Rpb24gbWF0Y2hlc1NvbWUoc3RyOiBzdHJpbmcsIHBhdHRlcm5zOiBJbW11dGFibGUuU2V0PE1pbmltYXRjaD4pIHtcbiAgcmV0dXJuIHBhdHRlcm5zLnNvbWUocGF0dGVybiA9PiBwYXR0ZXJuLm1hdGNoKHN0cikpO1xufVxuXG5mdW5jdGlvbiBpc1Zjc0lnbm9yZWQobm9kZUtleTogc3RyaW5nLCByZXBvOiA/YXRvbSRSZXBvc2l0b3J5KSB7XG4gIHJldHVybiByZXBvICYmIHJlcG8uaXNQcm9qZWN0QXRSb290KCkgJiYgcmVwby5pc1BhdGhJZ25vcmVkKG5vZGVLZXkpO1xufVxuXG5cbi8qKlxuICogUGVyZm9ybXMgYSBicmVhZHRoLWZpcnN0IGl0ZXJhdGlvbiBvdmVyIHRoZSBkaXJlY3RvcmllcyBvZiB0aGUgdHJlZSBzdGFydGluZ1xuICogd2l0aCBhIGdpdmVuIG5vZGUuIFRoZSBpdGVyYXRpb24gc3RvcHMgb25jZSBhIGdpdmVuIGxpbWl0IG9mIG5vZGVzIChib3RoIGRpcmVjdG9yaWVzXG4gKiBhbmQgZmlsZXMpIHdlcmUgdHJhdmVyc2VkLlxuICogVGhlIG5vZGUgYmVpbmcgY3VycmVudGx5IHRyYXZlcnNlZCBjYW4gYmUgb2J0YWluZWQgYnkgY2FsbGluZyAudHJhdmVyc2VkTm9kZSgpXG4gKiAubmV4dCgpIHJldHVybnMgYSBwcm9taXNlIHRoYXQgaXMgZnVsZmlsbGVkIHdoZW4gdGhlIHRyYXZlcnNhbCBtb3ZlcyBvbiB0b1xuICogdGhlIG5leHQgZGlyZWN0b3J5LlxuICovXG5jbGFzcyBGaWxlVHJlZVN0b3JlQmZzSXRlcmF0b3Ige1xuICBfZmlsZVRyZWVTdG9yZTogRmlsZVRyZWVTdG9yZTtcbiAgX3Jvb3RLZXk6IHN0cmluZztcbiAgX25vZGVzVG9UcmF2ZXJzZTogQXJyYXk8c3RyaW5nPjtcbiAgX2N1cnJlbnRseVRyYXZlcnNlZE5vZGU6ID9zdHJpbmc7XG4gIF9saW1pdDogbnVtYmVyO1xuICBfbnVtTm9kZXNUcmF2ZXJzZWQ6IG51bWJlcjtcbiAgX3Byb21pc2U6ID9Qcm9taXNlPHZvaWQ+O1xuICBfY291bnQ6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICAgIGZpbGVUcmVlU3RvcmU6IEZpbGVUcmVlU3RvcmUsXG4gICAgICByb290S2V5OiBzdHJpbmcsXG4gICAgICBub2RlS2V5OiBzdHJpbmcsXG4gICAgICBsaW1pdDogbnVtYmVyKSB7XG4gICAgdGhpcy5fZmlsZVRyZWVTdG9yZSA9IGZpbGVUcmVlU3RvcmU7XG4gICAgdGhpcy5fcm9vdEtleSA9IHJvb3RLZXk7XG4gICAgdGhpcy5fbm9kZXNUb1RyYXZlcnNlID0gW107XG4gICAgdGhpcy5fY3VycmVudGx5VHJhdmVyc2VkTm9kZSA9IG5vZGVLZXk7XG4gICAgdGhpcy5fbGltaXQgPSBsaW1pdDtcbiAgICB0aGlzLl9udW1Ob2Rlc1RyYXZlcnNlZCA9IDA7XG4gICAgdGhpcy5fcHJvbWlzZSA9IG51bGw7XG4gICAgdGhpcy5fY291bnQgPSAwO1xuICB9XG5cbiAgX2hhbmRsZVByb21pc2VSZXNvbHV0aW9uKGNoaWxkcmVuS2V5czogQXJyYXk8c3RyaW5nPik6IHZvaWQge1xuICAgIHRoaXMuX251bU5vZGVzVHJhdmVyc2VkICs9IGNoaWxkcmVuS2V5cy5sZW5ndGg7XG4gICAgaWYgKHRoaXMuX251bU5vZGVzVHJhdmVyc2VkIDwgdGhpcy5fbGltaXQpIHtcbiAgICAgIGNvbnN0IG5leHRMZXZlbE5vZGVzID0gY2hpbGRyZW5LZXlzLmZpbHRlcihjaGlsZEtleSA9PiBGaWxlVHJlZUhlbHBlcnMuaXNEaXJLZXkoY2hpbGRLZXkpKTtcbiAgICAgIHRoaXMuX25vZGVzVG9UcmF2ZXJzZSA9IHRoaXMuX25vZGVzVG9UcmF2ZXJzZS5jb25jYXQobmV4dExldmVsTm9kZXMpO1xuXG4gICAgICB0aGlzLl9jdXJyZW50bHlUcmF2ZXJzZWROb2RlID0gdGhpcy5fbm9kZXNUb1RyYXZlcnNlLnNwbGljZSgwLCAxKVswXTtcbiAgICAgIHRoaXMuX3Byb21pc2UgPSBudWxsO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRseVRyYXZlcnNlZE5vZGUgPSBudWxsO1xuICAgICAgdGhpcy5fcHJvbWlzZSA9IG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbmV4dCgpOiA/UHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY3VycmVudGx5VHJhdmVyc2VkTm9kZSA9IHRoaXMuX2N1cnJlbnRseVRyYXZlcnNlZE5vZGU7XG4gICAgaWYgKCF0aGlzLl9wcm9taXNlICYmIGN1cnJlbnRseVRyYXZlcnNlZE5vZGUpIHtcbiAgICAgIHRoaXMuX3Byb21pc2UgPSB0aGlzLl9maWxlVHJlZVN0b3JlLnByb21pc2VOb2RlQ2hpbGRLZXlzKFxuICAgICAgICB0aGlzLl9yb290S2V5LFxuICAgICAgICBjdXJyZW50bHlUcmF2ZXJzZWROb2RlKVxuICAgICAgLnRoZW4odGhpcy5faGFuZGxlUHJvbWlzZVJlc29sdXRpb24uYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9wcm9taXNlO1xuICB9XG5cbiAgdHJhdmVyc2VkTm9kZSgpOiA/c3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5fY3VycmVudGx5VHJhdmVyc2VkTm9kZTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbGVUcmVlU3RvcmU7XG4iXX0=