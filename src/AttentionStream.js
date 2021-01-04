
const getPageURL = require('./get-page-url');
const EventStreamStorage = require('./EventStreamStorage');
const OPTIONS_PAGE_PATH = "public/index.html";


module.exports = class AttentionStream {
    constructor() {
        this._onChangeHandlers = [];
        this._current = { firstRun: true };
        this.storage = new EventStreamStorage();
        this.initialize();
        // set up the local storage once
        // supported patterns are full URI, URI minus qs, domain, TLD+1?
    }

    initialize() {
        browser.tabs.onActivated.addListener(this._createGenericHandlerCase('tab-activated').bind(this))
        browser.tabs.onUpdated.addListener(this._handleUpdate.bind(this));
        browser.tabs.onRemoved.addListener(this._createGenericHandlerCase('tab-removed').bind(this));
        browser.tabs.onCreated.addListener(this._createGenericHandlerCase('tab-created').bind(this));

        browser.windows.onCreated.addListener(this._createGenericHandlerCase('window-created').bind(this));
        browser.windows.onRemoved.addListener(this._createGenericHandlerCase('window-removed').bind(this));
        browser.windows.onFocusChanged.addListener(this._createGenericHandlerCase('window-focus-changed').bind(this));

        browser.runtime.onConnect.addListener(
            p => this._onPortConnected(p));
    }

    _onPortConnected(port) {
        const sender = port.sender;
        if ((sender.id != browser.runtime.id)
          || (sender.url != browser.runtime.getURL(OPTIONS_PAGE_PATH))) {
          console.error("Rally Study - received message from unexpected sender");
          port.disconnect();
          return;
        }
    
        this._connectionPort = port;
    
        this._connectionPort.onMessage.addListener(
          m => this._handleMessage(m));
    
        // The onDisconnect event is fired if there's no receiving
        // end or in case of any other error. Log an error and clear
        // the port in that case.
        this._connectionPort.onDisconnect.addListener(e => {
          console.error("Rally Study - there was an error connecting to the page", e);
          this._connectionPort = null;
        });
      }

      // FIXME: tests
      _handleMessage(message) {
        // We only expect messages coming from the embedded options page
        // at this time. We check for the sender in `_onPortConnected`.
    
        switch (message.type) {
          case "get-data":
            this._sendDataToUI();
            break;
          case "reset":
            this.reset();
            break;
          default:
            return Promise.reject(
              new Error(`Rally Study - unexpected message type ${message.type}`));
        }
      }
    
      // FIXME: tests
      async _sendDataToUI() {
        // Send a message to the UI to update the list of studies.
        const events = await this.storage.get();
        this._connectionPort.postMessage(
          {type: "receive-data", data: events });
      }

    // FIXME: needs tests
    async reset() {
        this._resetCurrentEvent();
        await this.storage.reset();
        this._connectionPort.postMessage(
            { type: "reset-finished" });
        // set the firstRun event to true.
        this._current.firstRun = true;
    }

    // registers a change.
    onChange(fcn) {
        this._onChangeHandlers.push(fcn);
    }

    // FIXME: needs tests
    _finishEventAndStartNew({ reason, url }) {
        this._setEnd();
        const evt = { ...this._current };
        if (!this._current.firstRun) {
            this._submitEvent();
        }
        this._resetCurrentEvent();
        // set the start time.
        this._setStart();
        this._setURL(url);
        // add the reason the new event has been created.
        this._addReason(reason);
        return evt;
    }

    _addReason(reason) {
        this._current.reason = reason;
    }

    async _submitEvent() {
        // fill in details here.
        // store this as a kv pair
        await this.storage.push({...this._current});
      }
      
    _setDomain(domain) {
        this._current.domain = domain;
    }
    
    _setStart() {
        this._current.start = new Date();
    }

    _setURL(url) {
        this._current.url = url;
    }
    
    _setEnd() {
        this._current.end = new Date();
        this._current.elapsed = this._current.end - this._current.start;
    }
    
    _resetCurrentEvent() {
        this._current = { };
    }

    _handleChange(event) {
        this._onChangeHandlers.forEach(fcn => { fcn(event); } );
    }

    _urlIsNew(url) {
        // MOCK
        return url !== this._current.url;
    }

    _createGenericHandlerCase(reason) {
        // this is the case that most of these functions use.
        return async function() {
            const url = await getPageURL();
            if (this._urlIsNew(url)) {
                const finishedEvent = this._finishEventAndStartNew({ reason, url });
                if (!finishedEvent.firstRun) {
                    this._handleChange(finishedEvent);
                }
            }
        }
    }

    async _handleUpdate(_, changeInfo, everything = {}) {
        // skip this update if it is not in an active tab.
        if (everything.active === false) return;
        // reset on the loading event.
        if (changeInfo.status === 'loading' && changeInfo.url) {
            const fcn = this._createGenericHandlerCase('tab-updated').bind(this);
            await fcn('tab-updated');
        }
        if (changeInfo.status) this._current.status = changeInfo.status;
        if (changeInfo.title) this._current.title = changeInfo.title;
    }
}