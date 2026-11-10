// Signals Inspector 0.1.0 page hook. Generated from src/ by scripts/build.js; edit those.
// Includes signal-polyfill (Apache-2.0, https://github.com/proposal-signals/signal-polyfill).
(() => {
  // node_modules/signal-polyfill/dist/index.js
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };
  var __accessCheck = (obj, member, msg) => {
    if (!member.has(obj))
      throw TypeError("Cannot " + msg);
  };
  var __privateIn = (member, obj) => {
    if (Object(obj) !== obj)
      throw TypeError('Cannot use the "in" operator on this value');
    return member.has(obj);
  };
  var __privateAdd = (obj, member, value) => {
    if (member.has(obj))
      throw TypeError("Cannot add the same private member more than once");
    member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  };
  var __privateMethod = (obj, member, method) => {
    __accessCheck(obj, member, "access private method");
    return method;
  };
  /**
   * @license
   * Copyright Google LLC All Rights Reserved.
   *
   * Use of this source code is governed by an MIT-style license that can be
   * found in the LICENSE file at https://angular.io/license
   */
  function defaultEquals(a, b) {
    return Object.is(a, b);
  }
  /**
   * @license
   * Copyright Google LLC All Rights Reserved.
   *
   * Use of this source code is governed by an MIT-style license that can be
   * found in the LICENSE file at https://angular.io/license
   */
  var activeConsumer = null;
  var inNotificationPhase = false;
  var epoch = 1;
  var SIGNAL = /* @__PURE__ */ Symbol("SIGNAL");
  function setActiveConsumer(consumer) {
    const prev = activeConsumer;
    activeConsumer = consumer;
    return prev;
  }
  function getActiveConsumer() {
    return activeConsumer;
  }
  function isInNotificationPhase() {
    return inNotificationPhase;
  }
  var REACTIVE_NODE = {
    version: 0,
    lastCleanEpoch: 0,
    dirty: false,
    producerNode: void 0,
    producerLastReadVersion: void 0,
    producerIndexOfThis: void 0,
    nextProducerIndex: 0,
    liveConsumerNode: void 0,
    liveConsumerIndexOfThis: void 0,
    consumerAllowSignalWrites: false,
    consumerIsAlwaysLive: false,
    producerMustRecompute: () => false,
    producerRecomputeValue: () => {
    },
    consumerMarkedDirty: () => {
    },
    consumerOnSignalRead: () => {
    }
  };
  function producerAccessed(node) {
    if (inNotificationPhase) {
      throw new Error(
        typeof ngDevMode !== "undefined" && ngDevMode ? `Assertion error: signal read during notification phase` : ""
      );
    }
    if (activeConsumer === null) {
      return;
    }
    activeConsumer.consumerOnSignalRead(node);
    const idx = activeConsumer.nextProducerIndex++;
    assertConsumerNode(activeConsumer);
    if (idx < activeConsumer.producerNode.length && activeConsumer.producerNode[idx] !== node) {
      if (consumerIsLive(activeConsumer)) {
        const staleProducer = activeConsumer.producerNode[idx];
        producerRemoveLiveConsumerAtIndex(staleProducer, activeConsumer.producerIndexOfThis[idx]);
      }
    }
    if (activeConsumer.producerNode[idx] !== node) {
      activeConsumer.producerNode[idx] = node;
      activeConsumer.producerIndexOfThis[idx] = consumerIsLive(activeConsumer) ? producerAddLiveConsumer(node, activeConsumer, idx) : 0;
    }
    activeConsumer.producerLastReadVersion[idx] = node.version;
  }
  function producerIncrementEpoch() {
    epoch++;
  }
  function producerUpdateValueVersion(node) {
    if (!node.dirty && node.lastCleanEpoch === epoch) {
      return;
    }
    if (!node.producerMustRecompute(node) && !consumerPollProducersForChange(node)) {
      node.dirty = false;
      node.lastCleanEpoch = epoch;
      return;
    }
    node.producerRecomputeValue(node);
    node.dirty = false;
    node.lastCleanEpoch = epoch;
  }
  function producerNotifyConsumers(node) {
    if (node.liveConsumerNode === void 0) {
      return;
    }
    const prev = inNotificationPhase;
    inNotificationPhase = true;
    try {
      for (const consumer of node.liveConsumerNode) {
        if (!consumer.dirty) {
          consumerMarkDirty(consumer);
        }
      }
    } finally {
      inNotificationPhase = prev;
    }
  }
  function producerUpdatesAllowed() {
    return (activeConsumer == null ? void 0 : activeConsumer.consumerAllowSignalWrites) !== false;
  }
  function consumerMarkDirty(node) {
    var _a;
    node.dirty = true;
    producerNotifyConsumers(node);
    (_a = node.consumerMarkedDirty) == null ? void 0 : _a.call(node.wrapper ?? node);
  }
  function consumerBeforeComputation(node) {
    node && (node.nextProducerIndex = 0);
    return setActiveConsumer(node);
  }
  function consumerAfterComputation(node, prevConsumer) {
    setActiveConsumer(prevConsumer);
    if (!node || node.producerNode === void 0 || node.producerIndexOfThis === void 0 || node.producerLastReadVersion === void 0) {
      return;
    }
    if (consumerIsLive(node)) {
      for (let i = node.nextProducerIndex; i < node.producerNode.length; i++) {
        producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
      }
    }
    while (node.producerNode.length > node.nextProducerIndex) {
      node.producerNode.pop();
      node.producerLastReadVersion.pop();
      node.producerIndexOfThis.pop();
    }
  }
  function consumerPollProducersForChange(node) {
    assertConsumerNode(node);
    for (let i = 0; i < node.producerNode.length; i++) {
      const producer = node.producerNode[i];
      const seenVersion = node.producerLastReadVersion[i];
      if (seenVersion !== producer.version) {
        return true;
      }
      producerUpdateValueVersion(producer);
      if (seenVersion !== producer.version) {
        return true;
      }
    }
    return false;
  }
  function producerAddLiveConsumer(node, consumer, indexOfThis) {
    var _a;
    assertProducerNode(node);
    assertConsumerNode(node);
    if (node.liveConsumerNode.length === 0) {
      (_a = node.watched) == null ? void 0 : _a.call(node.wrapper);
      for (let i = 0; i < node.producerNode.length; i++) {
        node.producerIndexOfThis[i] = producerAddLiveConsumer(node.producerNode[i], node, i);
      }
    }
    node.liveConsumerIndexOfThis.push(indexOfThis);
    return node.liveConsumerNode.push(consumer) - 1;
  }
  function producerRemoveLiveConsumerAtIndex(node, idx) {
    var _a;
    assertProducerNode(node);
    assertConsumerNode(node);
    if (typeof ngDevMode !== "undefined" && ngDevMode && idx >= node.liveConsumerNode.length) {
      throw new Error(
        `Assertion error: active consumer index ${idx} is out of bounds of ${node.liveConsumerNode.length} consumers)`
      );
    }
    if (node.liveConsumerNode.length === 1) {
      (_a = node.unwatched) == null ? void 0 : _a.call(node.wrapper);
      for (let i = 0; i < node.producerNode.length; i++) {
        producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
      }
    }
    const lastIdx = node.liveConsumerNode.length - 1;
    node.liveConsumerNode[idx] = node.liveConsumerNode[lastIdx];
    node.liveConsumerIndexOfThis[idx] = node.liveConsumerIndexOfThis[lastIdx];
    node.liveConsumerNode.length--;
    node.liveConsumerIndexOfThis.length--;
    if (idx < node.liveConsumerNode.length) {
      const idxProducer = node.liveConsumerIndexOfThis[idx];
      const consumer = node.liveConsumerNode[idx];
      assertConsumerNode(consumer);
      consumer.producerIndexOfThis[idxProducer] = idx;
    }
  }
  function consumerIsLive(node) {
    var _a;
    return node.consumerIsAlwaysLive || (((_a = node == null ? void 0 : node.liveConsumerNode) == null ? void 0 : _a.length) ?? 0) > 0;
  }
  function assertConsumerNode(node) {
    node.producerNode ?? (node.producerNode = []);
    node.producerIndexOfThis ?? (node.producerIndexOfThis = []);
    node.producerLastReadVersion ?? (node.producerLastReadVersion = []);
  }
  function assertProducerNode(node) {
    node.liveConsumerNode ?? (node.liveConsumerNode = []);
    node.liveConsumerIndexOfThis ?? (node.liveConsumerIndexOfThis = []);
  }
  /**
   * @license
   * Copyright Google LLC All Rights Reserved.
   *
   * Use of this source code is governed by an MIT-style license that can be
   * found in the LICENSE file at https://angular.io/license
   */
  function computedGet(node) {
    producerUpdateValueVersion(node);
    producerAccessed(node);
    if (node.value === ERRORED) {
      throw node.error;
    }
    return node.value;
  }
  function createComputed(computation) {
    const node = Object.create(COMPUTED_NODE);
    node.computation = computation;
    const computed = () => computedGet(node);
    computed[SIGNAL] = node;
    return computed;
  }
  var UNSET = /* @__PURE__ */ Symbol("UNSET");
  var COMPUTING = /* @__PURE__ */ Symbol("COMPUTING");
  var ERRORED = /* @__PURE__ */ Symbol("ERRORED");
  var COMPUTED_NODE = /* @__PURE__ */ (() => {
    return {
      ...REACTIVE_NODE,
      value: UNSET,
      dirty: true,
      error: null,
      equal: defaultEquals,
      producerMustRecompute(node) {
        return node.value === UNSET || node.value === COMPUTING;
      },
      producerRecomputeValue(node) {
        if (node.value === COMPUTING) {
          throw new Error("Detected cycle in computations.");
        }
        const oldValue = node.value;
        node.value = COMPUTING;
        const prevConsumer = consumerBeforeComputation(node);
        let newValue;
        let wasEqual = false;
        try {
          newValue = node.computation.call(node.wrapper);
          const oldOk = oldValue !== UNSET && oldValue !== ERRORED;
          wasEqual = oldOk && node.equal.call(node.wrapper, oldValue, newValue);
        } catch (err) {
          newValue = ERRORED;
          node.error = err;
        } finally {
          consumerAfterComputation(node, prevConsumer);
        }
        if (wasEqual) {
          node.value = oldValue;
          return;
        }
        node.value = newValue;
        node.version++;
      }
    };
  })();
  /**
   * @license
   * Copyright Google LLC All Rights Reserved.
   *
   * Use of this source code is governed by an MIT-style license that can be
   * found in the LICENSE file at https://angular.io/license
   */
  function defaultThrowError() {
    throw new Error();
  }
  var throwInvalidWriteToSignalErrorFn = defaultThrowError;
  function throwInvalidWriteToSignalError() {
    throwInvalidWriteToSignalErrorFn();
  }
  /**
   * @license
   * Copyright Google LLC All Rights Reserved.
   *
   * Use of this source code is governed by an MIT-style license that can be
   * found in the LICENSE file at https://angular.io/license
   */
  function createSignal(initialValue) {
    const node = Object.create(SIGNAL_NODE);
    node.value = initialValue;
    const getter = () => {
      producerAccessed(node);
      return node.value;
    };
    getter[SIGNAL] = node;
    return getter;
  }
  function signalGetFn() {
    producerAccessed(this);
    return this.value;
  }
  function signalSetFn(node, newValue) {
    if (!producerUpdatesAllowed()) {
      throwInvalidWriteToSignalError();
    }
    if (!node.equal.call(node.wrapper, node.value, newValue)) {
      node.value = newValue;
      signalValueChanged(node);
    }
  }
  var SIGNAL_NODE = /* @__PURE__ */ (() => {
    return {
      ...REACTIVE_NODE,
      equal: defaultEquals,
      value: void 0
    };
  })();
  function signalValueChanged(node) {
    node.version++;
    producerIncrementEpoch();
    producerNotifyConsumers(node);
  }
  /**
   * @license
   * Copyright 2024 Bloomberg Finance L.P.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  var NODE = /* @__PURE__ */ Symbol("node");
  var Signal;
  ((Signal2) => {
    var _a, _brand, brand_fn, _b, _brand2, brand_fn2;
    class State {
      constructor(initialValue, options = {}) {
        __privateAdd(this, _brand);
        __publicField(this, _a);
        const ref = createSignal(initialValue);
        const node = ref[SIGNAL];
        this[NODE] = node;
        node.wrapper = this;
        if (options) {
          const equals = options.equals;
          if (equals) {
            node.equal = equals;
          }
          node.watched = options[Signal2.subtle.watched];
          node.unwatched = options[Signal2.subtle.unwatched];
        }
      }
      get() {
        if (!(0, Signal2.isState)(this))
          throw new TypeError("Wrong receiver type for Signal.State.prototype.get");
        return signalGetFn.call(this[NODE]);
      }
      set(newValue) {
        if (!(0, Signal2.isState)(this))
          throw new TypeError("Wrong receiver type for Signal.State.prototype.set");
        if (isInNotificationPhase()) {
          throw new Error("Writes to signals not permitted during Watcher callback");
        }
        const ref = this[NODE];
        signalSetFn(ref, newValue);
      }
    }
    _a = NODE;
    _brand = /* @__PURE__ */ new WeakSet();
    brand_fn = function() {
    };
    Signal2.isState = (s) => typeof s === "object" && __privateIn(_brand, s);
    Signal2.State = State;
    class Computed {
      // Create a Signal which evaluates to the value returned by the callback.
      // Callback is called with this signal as the parameter.
      constructor(computation, options) {
        __privateAdd(this, _brand2);
        __publicField(this, _b);
        const ref = createComputed(computation);
        const node = ref[SIGNAL];
        node.consumerAllowSignalWrites = true;
        this[NODE] = node;
        node.wrapper = this;
        if (options) {
          const equals = options.equals;
          if (equals) {
            node.equal = equals;
          }
          node.watched = options[Signal2.subtle.watched];
          node.unwatched = options[Signal2.subtle.unwatched];
        }
      }
      get() {
        if (!(0, Signal2.isComputed)(this))
          throw new TypeError("Wrong receiver type for Signal.Computed.prototype.get");
        return computedGet(this[NODE]);
      }
    }
    _b = NODE;
    _brand2 = /* @__PURE__ */ new WeakSet();
    brand_fn2 = function() {
    };
    Signal2.isComputed = (c) => typeof c === "object" && __privateIn(_brand2, c);
    Signal2.Computed = Computed;
    ((subtle2) => {
      var _a2, _brand3, brand_fn3, _assertSignals, assertSignals_fn;
      function untrack(cb) {
        let output;
        let prevActiveConsumer = null;
        try {
          prevActiveConsumer = setActiveConsumer(null);
          output = cb();
        } finally {
          setActiveConsumer(prevActiveConsumer);
        }
        return output;
      }
      subtle2.untrack = untrack;
      function introspectSources(sink) {
        var _a3;
        if (!(0, Signal2.isComputed)(sink) && !(0, Signal2.isWatcher)(sink)) {
          throw new TypeError("Called introspectSources without a Computed or Watcher argument");
        }
        return ((_a3 = sink[NODE].producerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
      }
      subtle2.introspectSources = introspectSources;
      function introspectSinks(signal) {
        var _a3;
        if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
          throw new TypeError("Called introspectSinks without a Signal argument");
        }
        return ((_a3 = signal[NODE].liveConsumerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
      }
      subtle2.introspectSinks = introspectSinks;
      function hasSinks(signal) {
        if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
          throw new TypeError("Called hasSinks without a Signal argument");
        }
        const liveConsumerNode = signal[NODE].liveConsumerNode;
        if (!liveConsumerNode)
          return false;
        return liveConsumerNode.length > 0;
      }
      subtle2.hasSinks = hasSinks;
      function hasSources(signal) {
        if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isWatcher)(signal)) {
          throw new TypeError("Called hasSources without a Computed or Watcher argument");
        }
        const producerNode = signal[NODE].producerNode;
        if (!producerNode)
          return false;
        return producerNode.length > 0;
      }
      subtle2.hasSources = hasSources;
      class Watcher {
        // When a (recursive) source of Watcher is written to, call this callback,
        // if it hasn't already been called since the last `watch` call.
        // No signals may be read or written during the notify.
        constructor(notify) {
          __privateAdd(this, _brand3);
          __privateAdd(this, _assertSignals);
          __publicField(this, _a2);
          let node = Object.create(REACTIVE_NODE);
          node.wrapper = this;
          node.consumerMarkedDirty = notify;
          node.consumerIsAlwaysLive = true;
          node.consumerAllowSignalWrites = false;
          node.producerNode = [];
          this[NODE] = node;
        }
        // Add these signals to the Watcher's set, and set the watcher to run its
        // notify callback next time any signal in the set (or one of its dependencies) changes.
        // Can be called with no arguments just to reset the "notified" state, so that
        // the notify callback will be invoked again.
        watch(...signals) {
          if (!(0, Signal2.isWatcher)(this)) {
            throw new TypeError("Called unwatch without Watcher receiver");
          }
          __privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
          const node = this[NODE];
          node.dirty = false;
          const prev = setActiveConsumer(node);
          for (const signal of signals) {
            producerAccessed(signal[NODE]);
          }
          setActiveConsumer(prev);
        }
        // Remove these signals from the watched set (e.g., for an effect which is disposed)
        unwatch(...signals) {
          if (!(0, Signal2.isWatcher)(this)) {
            throw new TypeError("Called unwatch without Watcher receiver");
          }
          __privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
          const node = this[NODE];
          assertConsumerNode(node);
          for (let i = node.producerNode.length - 1; i >= 0; i--) {
            if (signals.includes(node.producerNode[i].wrapper)) {
              producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
              const lastIdx = node.producerNode.length - 1;
              node.producerNode[i] = node.producerNode[lastIdx];
              node.producerIndexOfThis[i] = node.producerIndexOfThis[lastIdx];
              node.producerNode.length--;
              node.producerIndexOfThis.length--;
              node.nextProducerIndex--;
              if (i < node.producerNode.length) {
                const idxConsumer = node.producerIndexOfThis[i];
                const producer = node.producerNode[i];
                assertProducerNode(producer);
                producer.liveConsumerIndexOfThis[idxConsumer] = i;
              }
            }
          }
        }
        // Returns the set of computeds in the Watcher's set which are still yet
        // to be re-evaluated
        getPending() {
          if (!(0, Signal2.isWatcher)(this)) {
            throw new TypeError("Called getPending without Watcher receiver");
          }
          const node = this[NODE];
          return node.producerNode.filter((n) => n.dirty).map((n) => n.wrapper);
        }
      }
      _a2 = NODE;
      _brand3 = /* @__PURE__ */ new WeakSet();
      brand_fn3 = function() {
      };
      _assertSignals = /* @__PURE__ */ new WeakSet();
      assertSignals_fn = function(signals) {
        for (const signal of signals) {
          if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) {
            throw new TypeError("Called watch/unwatch without a Computed or State argument");
          }
        }
      };
      Signal2.isWatcher = (w) => __privateIn(_brand3, w);
      subtle2.Watcher = Watcher;
      function currentComputed() {
        var _a3;
        return (_a3 = getActiveConsumer()) == null ? void 0 : _a3.wrapper;
      }
      subtle2.currentComputed = currentComputed;
      subtle2.watched = /* @__PURE__ */ Symbol("watched");
      subtle2.unwatched = /* @__PURE__ */ Symbol("unwatched");
    })(Signal2.subtle || (Signal2.subtle = {}));
  })(Signal || (Signal = {}));

  // src/core.js
  var HOOK_VERSION = 1;
  var MAX_EVENTS = 2e3;
  var MAX_NODES = 2e3;
  var MARK = /* @__PURE__ */ Symbol.for("signals-inspector");
  function createInspector(Base, { base = "unknown", now = () => performance.now() } = {}) {
    if (!Base?.State || !Base?.Computed || !Base?.subtle?.Watcher) {
      throw new TypeError("createInspector needs an implementation of the Signals API");
    }
    let nextId = 1;
    let seq = 0;
    const ids = /* @__PURE__ */ new WeakMap();
    const nodes = /* @__PURE__ */ new Map();
    const events = [];
    const gone = new FinalizationRegistry((id) => nodes.delete(id));
    const runtimes = [];
    const settings = { writeStacks: false, ignore: ["/node_modules/"] };
    let ignored = [];
    const compileIgnore = () => {
      ignored = settings.ignore.map((pattern) => {
        try {
          return new RegExp(pattern);
        } catch {
          return { test: (url) => url.includes(pattern) };
        }
      });
    };
    compileIgnore();
    const ownUrl = ownLocation();
    const own = { url: ownUrl, skip: (url) => ignored.some((re) => re.test(url)) };
    function track(signal, kind, options, runtime = null, impl = Base) {
      let id = ids.get(signal);
      if (id) return nodes.get(id);
      id = nextId++;
      ids.set(signal, id);
      const meta = {
        id,
        kind,
        ref: new WeakRef(signal),
        impl,
        runtime,
        label: labelFrom(options),
        site: runtime ? null : callSite(own),
        equals: typeof options?.equals === "function" ? options.equals : Object.is,
        created: seq,
        sets: 0,
        runs: 0,
        notifies: 0,
        lastChange: -1,
        lastRun: -1,
        hasValue: false,
        value: void 0,
        error: null,
        causes: []
      };
      nodes.set(id, meta);
      gone.register(signal, id);
      if (!runtime) record("create", meta, {});
      return meta;
    }
    const metaOf = (signal) => {
      const id = signal && ids.get(signal);
      return id ? nodes.get(id) : void 0;
    };
    function record(type, meta, data) {
      const event = { seq: ++seq, t: Math.round(now() * 100) / 100, type, id: meta.id, ...data };
      events.push(event);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      return event;
    }
    const untracked = (impl, fn) => {
      try {
        return { ok: true, value: impl.subtle.untrack(fn) };
      } catch (error) {
        return { ok: false, error };
      }
    };
    const sourcesOf = (impl, signal) => {
      try {
        return impl.subtle.introspectSources(signal);
      } catch {
        return [];
      }
    };
    const sinksOf = (impl, signal) => {
      try {
        return impl.subtle.introspectSinks(signal);
      } catch {
        return [];
      }
    };
    class State extends Base.State {
      constructor(value, options) {
        super(value, options);
        track(this, "state", options);
      }
      set(value) {
        const meta = metaOf(this) ?? track(this, "state");
        const before = untracked(Base, () => super.get());
        super.set(value);
        meta.sets++;
        let changed = true;
        if (before.ok) {
          try {
            changed = !meta.equals.call(this, before.value, value);
          } catch {
            changed = true;
          }
        }
        const event = record("set", meta, {
          from: before.ok ? preview(before.value) : "?",
          to: preview(value),
          changed
        });
        if (settings.writeStacks) event.stack = callSite(own, true);
        if (changed) meta.lastChange = event.seq;
      }
    }
    class Computed extends Base.Computed {
      constructor(callback, options) {
        if (typeof callback !== "function") {
          super(callback, options);
          return;
        }
        super(function inspectedComputation() {
          return run(this, callback);
        }, options);
        track(this, "computed", options);
      }
    }
    function run(computed, callback) {
      const meta = metaOf(computed) ?? track(computed, "computed");
      const causes = [];
      if (meta.lastRun >= 0) {
        for (const source of sourcesOf(Base, computed)) {
          const sourceMeta = metaOf(source);
          if (sourceMeta && sourceMeta.lastChange > meta.lastRun && !causes.includes(sourceMeta.id)) {
            causes.push(sourceMeta.id);
          }
        }
      }
      const first = meta.lastRun < 0;
      meta.lastRun = seq;
      const start = now();
      let value;
      try {
        value = callback.call(computed);
      } catch (error) {
        meta.runs++;
        meta.error = preview(error);
        meta.causes = causes;
        const event2 = record("error", meta, { causes, ms: round(now() - start), error: meta.error });
        meta.lastChange = event2.seq;
        meta.lastRun = event2.seq - 1;
        throw error;
      }
      meta.runs++;
      let changed = true;
      if (meta.hasValue && !meta.error) {
        try {
          changed = !meta.equals.call(computed, meta.value, value);
        } catch {
          changed = true;
        }
      }
      meta.error = null;
      meta.hasValue = true;
      meta.value = value;
      meta.causes = causes;
      const event = record("run", meta, { causes, first, changed, ms: round(now() - start), to: preview(value) });
      meta.lastRun = event.seq - 1;
      if (changed) meta.lastChange = event.seq;
      return value;
    }
    class Watcher extends Base.subtle.Watcher {
      constructor(notify) {
        if (typeof notify !== "function") {
          super(notify);
          return;
        }
        super(function inspectedNotify(...args) {
          const meta = metaOf(this);
          if (meta) {
            meta.notifies++;
            record("notify", meta, {});
          }
          return notify.apply(this, args);
        });
        track(this, "watcher");
      }
    }
    const subtle = copy(Base.subtle);
    subtle.Watcher = Watcher;
    const Signal2 = copy(Base);
    Signal2.State = State;
    Signal2.Computed = Computed;
    Signal2.subtle = Object.freeze(subtle);
    Object.defineProperty(Signal2, MARK, { value: { base } });
    Object.freeze(Signal2);
    function register({ name = "runtime", Signal: impl, watchers = [] } = {}) {
      if (!impl?.subtle?.introspectSources) throw new TypeError("register() needs the runtime's Signal");
      const entry = { name: String(name), Signal: impl, watchers: /* @__PURE__ */ new Set() };
      const add = (watcher) => {
        entry.watchers.add(new WeakRef(watcher));
      };
      for (const watcher of watchers) add(watcher);
      runtimes.push(entry);
      return {
        addWatcher: add,
        dispose() {
          const at = runtimes.indexOf(entry);
          if (at >= 0) runtimes.splice(at, 1);
        }
      };
    }
    function kindIn(impl, signal) {
      if (signal instanceof impl.State) return "state";
      if (signal instanceof impl.Computed) return "computed";
      if (signal instanceof impl.subtle.Watcher) return "watcher";
      return "signal";
    }
    function discover() {
      for (const entry of runtimes) {
        const impl = entry.Signal;
        const seen = /* @__PURE__ */ new Set();
        const stack = [];
        for (const ref of entry.watchers) {
          const watcher = ref.deref();
          if (!watcher) entry.watchers.delete(ref);
          else stack.push(watcher);
        }
        while (stack.length && seen.size < MAX_NODES) {
          const signal = stack.pop();
          if (seen.has(signal)) continue;
          seen.add(signal);
          if (!metaOf(signal)) track(signal, kindIn(impl, signal), void 0, entry.name, impl);
          for (const source of sourcesOf(impl, signal)) stack.push(source);
        }
      }
    }
    function valueOf(meta, signal) {
      if (meta.kind === "watcher") return { value: null };
      if (meta.kind === "computed" && !meta.runtime) {
        if (meta.error) return { value: meta.error, error: true };
        return meta.hasValue ? { value: preview(meta.value) } : { value: null, unread: true };
      }
      const read = untracked(meta.impl, () => signal.get());
      return read.ok ? { value: preview(read.value) } : { value: preview(read.error), error: true };
    }
    function snapshot(since = 0) {
      discover();
      const list = [];
      const edges = [];
      for (const meta of nodes.values()) {
        if (list.length >= MAX_NODES) break;
        const signal = meta.ref.deref();
        if (!signal) continue;
        const { value, error, unread } = valueOf(meta, signal);
        const sinks = meta.kind === "watcher" ? [] : sinksOf(meta.impl, signal);
        list.push({
          id: meta.id,
          kind: meta.kind,
          label: meta.label,
          site: meta.site,
          runtime: meta.runtime,
          value,
          error: !!error,
          unread: !!unread,
          live: meta.kind === "watcher" ? true : sinks.length > 0,
          sets: meta.sets,
          runs: meta.runs,
          notifies: meta.notifies,
          lastChange: meta.lastChange,
          causes: meta.causes
        });
        if (meta.kind !== "state") {
          for (const source of sourcesOf(meta.impl, signal)) {
            const sourceMeta = metaOf(source) ?? track(source, kindIn(meta.impl, source), void 0, meta.runtime, meta.impl);
            if (!edges.some(([from, to]) => from === sourceMeta.id && to === meta.id)) edges.push([sourceMeta.id, meta.id]);
          }
        }
      }
      return {
        version: HOOK_VERSION,
        base,
        provided: globalThis.Signal === Signal2,
        seq,
        settings: { writeStacks: settings.writeStacks, ignore: [...settings.ignore] },
        runtimes: runtimes.map((entry) => ({ name: entry.name, watchers: entry.watchers.size })),
        nodes: list,
        edges,
        events: since > 0 ? events.filter((event) => event.seq > since) : events.slice(-500),
        dropped: since > 0 && events.length > 0 && events[0].seq > since + 1
      };
    }
    function get(id) {
      return nodes.get(id)?.ref.deref();
    }
    const hook = {
      version: HOOK_VERSION,
      Signal: Signal2,
      register,
      snapshot,
      get,
      /** Give a signal a readable name in DevTools (the proposal has no name option). */
      label(signal, name) {
        const meta = metaOf(signal);
        if (meta) meta.label = String(name);
        return signal;
      },
      /** Write a state from DevTools. `json` is parsed; a non-JSON string is written as is. */
      setValue(id, json) {
        const signal = get(id);
        if (!(signal instanceof nodes.get(id).impl.State)) throw new Error("Only a State can be written");
        let value = json;
        try {
          value = JSON.parse(json);
        } catch {
        }
        signal.set(value);
        return true;
      },
      /** Log a signal and its current value to the page's console. */
      log(id) {
        const meta = nodes.get(id);
        const signal = get(id);
        if (!signal) return false;
        const read = meta.kind === "watcher" ? { ok: true, value: void 0 } : untracked(meta.impl, () => signal.get());
        console.log(`[signals] #${id} ${meta.label ?? meta.kind}`, read.ok ? read.value : read.error, signal);
        return true;
      },
      configure(next) {
        if (typeof next?.writeStacks === "boolean") settings.writeStacks = next.writeStacks;
        return { ...settings };
      },
      /**
       * Look past frames whose URL matches when naming where signals are made: a runtime calls
       * this with its own location so creation sites point at the code that uses it.
       * Patterns are regular expression sources (or plain substrings if they don't parse).
       */
      ignoreFrames(...patterns) {
        for (const pattern of patterns) if (typeof pattern === "string" && !settings.ignore.includes(pattern)) settings.ignore.push(pattern);
        compileIgnore();
        return [...settings.ignore];
      },
      clearEvents() {
        events.length = 0;
        return seq;
      }
    };
    return { Signal: Signal2, hook };
  }
  function copy(object) {
    const out = {};
    for (const key of Reflect.ownKeys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if ("value" in descriptor) out[key] = descriptor.value;
      else Object.defineProperty(out, key, { ...descriptor, configurable: true });
    }
    return out;
  }
  var round = (ms) => Math.round(ms * 1e3) / 1e3;
  function labelFrom(options) {
    const name = options?.name ?? options?.label ?? options?.debugName;
    return typeof name === "string" && name ? name : null;
  }
  function ownLocation() {
    const line = (new Error().stack ?? "").split("\n").find((l) => /(\w+:\/\/|\/)[^\s)]+:\d+/.test(l));
    return line?.match(/((?:\w+:\/\/)?[^\s()]+?):\d+:\d+/)?.[1] ?? null;
  }
  var FRAME = /^\s*(?:at\s+)?(?:(.*?)\s+\()?(?:.*?@)?((?:\w[\w+.-]*:\/\/|\/)[^\s()]+?):(\d+):(\d+)\)?\s*$/;
  function callSite(own, several = false) {
    const frames = [];
    let fallback = null;
    for (const line of (new Error().stack ?? "").split("\n")) {
      const match = line.match(FRAME);
      if (!match) continue;
      const [, fn, url, row, column] = match;
      if (url === own.url) continue;
      const frame = { url, line: Number(row), column: Number(column), fn: fn?.replace(/^(async |new )/, "") || null };
      if (several) {
        frames.push(frame);
        if (frames.length >= 6) break;
        continue;
      }
      fallback ??= frame;
      if (!own.skip(url)) return frame;
    }
    return several ? frames : fallback;
  }
  function preview(value, depth = 0) {
    const type = typeof value;
    if (value === null || value === void 0 || type === "boolean" || type === "number") return String(value);
    if (type === "bigint") return `${value}n`;
    if (type === "string") return depth ? JSON.stringify(cut(value, 60)) : JSON.stringify(cut(value, 200));
    if (type === "symbol") return value.toString();
    if (type === "function") return `\u0192 ${value.name || "anonymous"}()`;
    if (value instanceof Error) return `${value.name}: ${cut(value.message, 160)}`;
    if (typeof Node !== "undefined" && value instanceof Node) {
      return value.nodeType === 1 ? `<${value.localName}${value.id ? `#${value.id}` : ""}>` : `#${value.nodeName}`;
    }
    if (value instanceof Date) return `Date(${isNaN(value) ? "Invalid" : value.toISOString()})`;
    if (value instanceof Map) return `Map(${value.size})`;
    if (value instanceof Set) return `Set(${value.size})`;
    if (Array.isArray(value)) {
      if (depth >= 2) return `Array(${value.length})`;
      const items = value.slice(0, 10).map((item) => preview(item, depth + 1));
      return `[${items.join(", ")}${value.length > 10 ? `, \u2026${value.length - 10} more` : ""}]`;
    }
    if (type === "object") {
      const name = value.constructor && value.constructor !== Object ? value.constructor.name : "";
      if (depth >= 2) return name ? `${name} {\u2026}` : "{\u2026}";
      let keys;
      try {
        keys = Object.keys(value);
      } catch {
        return name || "Object";
      }
      const parts = keys.slice(0, 8).map((key) => {
        let item;
        try {
          item = preview(value[key], depth + 1);
        } catch {
          item = "?";
        }
        return `${key}: ${item}`;
      });
      return `${name ? `${name} ` : ""}{${parts.join(", ")}${keys.length > 8 ? ", \u2026" : ""}}`;
    }
    return String(value);
  }
  var cut = (text, max) => text.length > max ? `${text.slice(0, max)}\u2026` : text;

  // src/hook.js
  if (!globalThis.__SIGNALS_DEVTOOLS_HOOK__) {
    const native = globalThis.Signal;
    const { Signal: Signal2, hook } = createInspector(native ?? Signal, { base: native ? "native" : "polyfill" });
    Object.defineProperty(globalThis, "Signal", { value: Signal2, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(globalThis, "__SIGNALS_DEVTOOLS_HOOK__", { value: hook, configurable: true, enumerable: false });
  }
})();
