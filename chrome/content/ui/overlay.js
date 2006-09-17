// GLOBAL STATE
// ----------------------------------------------------------------------

var xmppChannel = XMPP.createChannel();


// NETWORK REACTIONS
// ----------------------------------------------------------------------

// Show progress bar when waiting for connection

xmppChannel.on(
    { event: 'stream', direction: 'out', state: 'open' },
    function(stream) {
        document
            .getElementById('xmpp-connecting-account').value = stream.session.name;
        document
            .getElementById('xmpp-status').hidden = false;
    });

// Hiding progress bar when stream is closed

xmppChannel.on(
    { event: 'stream', state: 'close' },
    function(stream) {
        if(document)
            document
                .getElementById('xmpp-status').hidden = true;
    });

// Hiding progress bar when authentication is accepted

xmppChannel.on(
    { event: 'iq', direction: 'out', stanza: function(s) {
            return (s.@type == 'set' &&
                    s.*::query.length() > 0 &&
                    s.*::query.name().uri == 'jabber:iq:auth') }},
    function(iq) {
        xmppChannel.on({
            event: 'iq',  // TODO: need one-shot listeners here!
            direction: 'in',
            session: function(s) {
                    return s.name == iq.session.name;
                },
            stanza: function(s) {
                    return s.@id == iq.stanza.@id;
                }},
            function(reply) {
                document.
                    getElementById('xmpp-status').hidden = true;
            });
    });

// Changing availability and show attributes on toolbar button based
// on a summary of presences of connected accounts.

xmppChannel.on(
    { event: 'presence', direction: 'out', stanza: function(s) {
            return s.@type == undefined;
        }},
    function(presence) {
        var summary = XMPP.presenceSummary();
        var button = document.getElementById('xmpp-button');
        button.setAttribute('availability', summary.stanza.@type.toString() || 'available');
        button.setAttribute('show', summary.stanza.show.toString());
    });

xmppChannel.on(
    { event: 'stream', direction: 'out', state: 'close' },
    function(stream) {
        if(XMPP.accounts.every(XMPP.isDown)) {
            var button = document.getElementById('xmpp-button');
            button.setAttribute('availability', 'unavailable');
            button.setAttribute('show', '');
        }
    });


// GUI ACTIONS
// ----------------------------------------------------------------------

function xmppDisableContent() {
    XMPP.disableContentDocument(getBrowser().selectedBrowser);
}

function xmppRefresh() {
    var browser = getBrowser().selectedBrowser;
    var toolbox = document.getElementById('xmpp-toolbox');

    if(browser.hasAttribute('address') &&
       browser.hasAttribute('account')) {
        var toolbar = document.getElementById('xmpp-toolbox-toolbar');
        var tooltip = document.getElementById('xmpp-toolbox-tooltip');        
        toolbar.getElementsByAttribute('role', 'address')[0].value = browser.getAttribute('address');
        tooltip.getElementsByAttribute('role', 'address')[0].value = browser.getAttribute('address');
        tooltip.getElementsByAttribute('role', 'account')[0].value = browser.getAttribute('account');
        toolbox.hidden = false;
    } else
        toolbox.hidden = true;
}

function xmppAddToolbarButton() {
    var toolbox = document.getElementById('navigator-toolbox');
    var toolbar = toolbox.getElementsByAttribute('id', 'nav-bar')[0];
        
    if(toolbar &&
       toolbar.currentSet.indexOf('xmpp-button') == -1 &&
       toolbar.getAttribute('customizable') == 'true') {

        toolbar.currentSet = toolbar.currentSet.replace(
            /urlbar-container/,
            'xmpp-button,urlbar-container');
        toolbar.setAttribute('currentset', toolbar.currentSet);
        toolbox.ownerDocument.persist(toolbar.id, 'currentset');
    }
}

function xmppRequestedChangeStatus(event) {
    xmppChangeStatus(event.target.value);
}


// NETWORK ACTIONS
// ----------------------------------------------------------------------

function xmppChangeStatus(type) {
    for each(var account in XMPP.accounts) {
        if(XMPP.isUp(account)) {
            if(type == 'unavailable')
                XMPP.down(account);
            else {
                var stanza;
                for each(var presence in XMPP.cache.presenceOut) 
                    if(presence.session.name == account.jid) {
                        stanza = presence.stanza.copy();
                        break;
                    }

                stanza = stanza || <presence/>;

                switch(type) {
                case 'available':
                    delete stanza.show;
                    break;
                case 'away':
                    stanza.show = <show>away</show>;
                    break;
                case 'dnd':
                    stanza.show = <show>dnd</show>;
                    break;
                }
                XMPP.send(account, stanza);
            }
        }
    }
}


// GUI REACTIONS
// ----------------------------------------------------------------------

window.addEventListener(
    'load', function(event) {
        var prefBranch = Components
            .classes["@mozilla.org/preferences-service;1"]
            .getService(Components.interfaces.nsIPrefBranch);

        if(prefBranch.getBoolPref('xmpp.firstInstall')) {
            prefBranch.setBoolPref('xmpp.firstInstall', false);
            xmppAddToolbarButton();
        }
    }, false);

var xmppLocationChangeListener = {
    QueryInterface: function(aIID) {
        if(aIID.equals(Components.interfaces.nsIWebProgressListener) ||
           aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
           aIID.equals(Components.interfaces.nsISupports))
            return this;
        throw Components.results.NS_NOINTERFACE;
    },
    onLocationChange: function(aProgress, aRequest, aURI) {
        xmppRefresh();
    },
    onStateChange: function(aProgress, aRequest, aStateFlags, aStatus) {},
    onProgressChange: function() {},
    onStatusChange: function() {},
    onSecurityChange: function() {},
    onLinkIconAvailable: function() {}
};

window.addEventListener(
    'load', function(event) {
        getBrowser().addProgressListener(xmppLocationChangeListener);

        getBrowser().addEventListener(
            'DOMAttrModified', function(event) {
                if(event.attrName == 'address')
                    xmppRefresh();
            }, false);
    }, false);


// GUI HOOKS
// ----------------------------------------------------------------------

function xmppSelectedAccount(accountJid) {
    if(XMPP.isUp(accountJid))
        XMPP.down(accountJid);
    else
        XMPP.up(accountJid);
}
