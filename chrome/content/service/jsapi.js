/*
 * Copyright 2006-2007 by Massimiliano Mirra
 * 
 * This file is part of xmpp4moz.
 * 
 * xmpp4moz is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 3 of the License, or (at your
 * option) any later version.
 * 
 * xmpp4moz is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 * Author: Massimiliano Mirra, <bard [at] hyperstruct [dot] net>
 *  
 */


/**
 * This is a convenience stateless wrapper to the bare XPCOM service,
 * to allow using it more comfortably from javascript.
 *
 * Creating a channel that filters incoming events:
 *
 *     var channel = XMPP.createChannel();
 *     channel.on(
 *         {event: 'message', direction: 'in'},
 *         function(message) { alert(message.stanza); } );
 *
 * Bringing up a session: 
 *     
 *     XMPP.up(
 *         'user@server.org/Resource',
 *         {password: 'secret'});
 *
 * Sending a stanza:
 *
 *     XMPP.send(
 *         'user@server.org/Resource',
 *         <message to="contact@server.org">
 *         <body>hello</body>
 *         </message>);
 *     
 */

// GLOBAL DEFINITIONS
// ----------------------------------------------------------------------

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const service = Cc['@hyperstruct.net/xmpp4moz/xmppservice;1']
    .getService(Ci.nsIXMPPClientService);
    
const pref = Cc['@mozilla.org/preferences-service;1']
    .getService(Ci.nsIPrefService)
    .getBranch('xmpp.');

const serializer = Cc['@mozilla.org/xmlextras/xmlserializer;1']
    .getService(Ci.nsIDOMSerializer);

const srvPrompt = Cc["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Ci.nsIPromptService);

const ns_x4m        = 'http://hyperstruct.net/xmpp4moz';
const ns_muc        = 'http://jabber.org/protocol/muc';
const ns_roster     = 'jabber:iq:roster';
const ns_disco_info = 'http://jabber.org/protocol/disco#info';

var [Query] = load('chrome://xmpp4moz/content/lib/query.js', 'Query');
var [Channel] = load('chrome://xmpp4moz/content/lib/channel.js', 'Channel');


// DEVELOPER INTERFACE
// ----------------------------------------------------------------------

var cache = {
    find: function(pattern) {
        return this.fetch(pattern)[0];
    },

    first: function(query) {
        return this._wrapResult(
            service.wrappedJSObject.cache.first(
                (typeof(query.compile) == 'function') ? query.compile() : query));
    },

    all: function(query) {
        var stanzas = service.wrappedJSObject.cache.all(
            (typeof(query.compile) == 'function') ? query.compile() : query);
        var results = [];
        for(var i=0; i<stanzas.snapshotLength; i++)
            results.push(this._wrapResult(stanzas.snapshotItem(i)));
        return results;
    },

    fetch: function(pattern) {
        var remotePattern = {}, localPattern = {};
        for(var member in pattern)
            if(typeof(pattern[member]) == 'function') {
                localPattern[member] = pattern[member];
            } else {
                remotePattern[member] = pattern[member];
            } 

        var stanzas = service.wrappedJSObject.cache.all(
            this._patternToQuery(remotePattern).compile());
        
        var wrappedPartialResults = [];
        for(var i=0; i<stanzas.snapshotLength; i++) { 
            var stanza = stanzas.snapshotItem(i);
            
            wrappedPartialResults.push(this._wrapResult(stanza));
        }
        
        return wrappedPartialResults.filter(function(event) { return match(event, localPattern); });
    },

    _wrapResult: function(stanza) {
        var meta = stanza.getElementsByTagNameNS(ns_x4m, 'meta')[0];
        return {
            stanza    : dom2xml(stanza),
            direction : meta.getAttribute('direction'),
            account   : meta.getAttribute('account'),
            session   : { name: meta.getAttribute('account')}
        };
    },

    _patternToQuery: function(pattern) {
        var query = q();
        for(var ruleName in pattern) {
            switch(typeof(pattern[ruleName])) {
            case 'string':
                query = query[ruleName](pattern[ruleName]);
                break;
            case 'object':
                if(ruleName == 'session' && pattern[ruleName].name)
                    query = query.account(pattern[ruleName].name);
                else if(ruleName == 'from' && pattern[ruleName].address)
                    query = query.from(pattern[ruleName].address)
                else if(ruleName == 'from' && pattern[ruleName].full)
                    query = query.from(pattern[ruleName].address)                
                else
                    throw new Error('Unhandled case when converting pattern to query. (' +
                                    ruleName + ': ' + pattern[ruleName].toSource() + ')');
                break;
            default:
                throw new Error('Unhandled type when converting pattern to query. (' +
                                typeof(pattern[ruleName]) + ')');
            }
        }
        return query;
    }
};

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.nickFor

function nickFor(account, address) {
    var roster = cache.find({
        event     : 'iq',
        direction : 'in',
        account   : account,
        stanza    : function(s) { return s.ns_roster::query != undefined; }});
        
    var name;
    if(roster) {
        var item = roster.stanza..ns_roster::item
            .(@jid == address);
        name = item.@name.toString();
    }

    return name || JID(address).username || address;
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.JID

function JID(string) {
    var memo = arguments.callee.memo || (arguments.callee.memo = {});
    if(string in memo)
        return memo[string];
    var m = string.match(/^(.+?@)?(.+?)(?:\/|$)(.*$)/);

    var jid = {};

    if(m[1])
        jid.username = m[1].slice(0, -1);

    jid.hostname = m[2];
    jid.resource = m[3];
    jid.nick     = m[3];
    jid.full     = m[3] ? string : null;
    jid.address  = jid.username ?
        jid.username + '@' + jid.hostname :
        jid.hostname;

    memo[string] = jid;
    return jid;    
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.up

function up(account, extra) {
    // Normalize arguments (including deprecated ones) so that _up()
    // can concentrate on the real job.

    var continuation;
    if(typeof(extra) == 'function')
        continuation = extra;
    else if(typeof(extra) == 'object') {
        deprecation(
            'opts parameter will be removed, use account instead.');
        if(extra.ssl)
            account.connectionSecurity = 1;
        if(extra.host)
            account.connectionHost = extra.host;
        if(extra.port)
            account.connectionPort = extra.port;
        if(extra.continuation)
            continuation = extra.continuation;
    }
    
    if(!account)
        account = {};
    else if(typeof(account) == 'string')
        account = getAccountByJid(account);
    
    if(account.jid)
        _up(account, continuation);
    else
        _up(null, function(jid) {
                account.jid = jid;
                if(continuation)
                    continuation(jid);
            });
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.down

function down(account) {
    if(isDown(account))
        return;

    var jid = 
        (typeof(account) == 'object' && account.jid) ?
        account.jid : account;

    send(jid, <presence type="unavailable"/>);
    service.close(jid);
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.isUp

function isUp(account) {
    return service.isUp(
        typeof(account) == 'object' ? account.jid : account);
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.isDown

function isDown(account) {
    return !isUp(account);
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.send

function send(account, stanza, handler) {
    if(isUp(account))
        _send(account.jid || account, stanza, handler);
    else
        up(account, function(jid) {
               _send(jid, stanza, handler);
           });
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.createChannel

function createChannel(features) {
    var channel = new Channel();
    
    channel.onRelease = function() {
        service.removeObserver(this, null, null);
        if(features)
            for each(var feature in features.ns_disco_info::feature) {
                service.removeFeature(feature.toXMLString());
            }
    }

    if(features)
        for each(var feature in features.ns_disco_info::feature) {
            service.addFeature(feature.toXMLString());
        }

    service.addObserver(channel, null, null);
    return channel;
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.open

function open(jid, opts, continuation) {
    var connectionHost = opts.host || JID(jid).hostname;
    var connectionPort = opts.port || 5223;
    var ssl = (opts.ssl == undefined ? true : opts.ssl);

    var streamReplyObserver = {
        observe: function(subject, topic, data) {
            continuation();
        }
    };

    var transport = Cc['@hyperstruct.net/xmpp4moz/xmpptransport;1?type=tcp']
        .createInstance(Ci.nsIXMPPTransport);
    transport.init(JID(jid).hostname, connectionHost, connectionPort, ssl);

    service.open(jid, transport, streamReplyObserver);
}

// http://dev.hyperstruct.net/xmpp4moz/wiki/DocLocalAPI#XMPP.close

function close(jid) {
    service.close(jid);
}


// UTILITIES
// ----------------------------------------------------------------------

function q() {
    return new Query();
}

function load(url) {
    var loader = (Cc['@mozilla.org/moz/jssubscript-loader;1']
                  .getService(Ci.mozIJSSubScriptLoader));

    var context = {};
    loader.loadSubScript(url, context);
    
    var names = Array.slice(arguments, 1);
    return names.map(function(name) { return context[name]; });
}

/**
 * Pattern matcher as used in channel.on().
 *
 */

function match(object, template) {
    var pattern, value;
    for(var member in template) {
        value = object[member];
        pattern = template[member];
        
        if(pattern === undefined)
            ;
        else if(pattern && typeof(pattern) == 'function') {
            if(!pattern(value))
                return false;
        }
        else if(pattern && typeof(pattern.test) == 'function') {
            if(!pattern.test(value))
                return false;
        }
        else if(pattern && pattern.id) {
            if(pattern.id != value.id)
                return false;
        }
        else if(pattern != value)
            return false;
    } 

    return true;
}

/**
 * Convert a DOM element to an E4X XML object.
 *
 * Assign converted object to DOM element behind the scenes, so that
 * if it requested to be converted again, there is no need to go
 * through serialization/deserialization again.
 *
 * (This assumes that the element is immutable.)
 *
 */

function dom2xml(element) {
    if(!element.__dom2xml_memo)
        element.__dom2xml_memo = new XML(serializer.serializeToString(element));
    
    return element.__dom2xml_memo;
}

function uniq(array) {
    var encountered = [];

    return array.filter(
        function(item) {
            if(encountered.indexOf(item) == -1) {
                encountered.push(item);
                return true;
            } else
                return false;
        });
}

// The roster segment is a roster where the only entry is the
// contact we are connecting to (if in roster, otherwise it's
// empty).

function rosterSegment(account, address) {
    var roster = cache.first(q()
                             .event('iq')
                             .direction('in')
                             .account(account)
                             .query('roster'));
    var segment =
        <iq type="result" from={account} to={account}>
        <query xmlns={ns_roster}/>
        </iq>;

    var item = roster.stanza..ns_roster::item.(@jid == address);
    if(item != undefined)
        segment.ns_roster::query.ns_roster::item = item;
    else
        segment.ns_roster::query.ns_roster::item = <item jid={address} subscription="none"/>

    return segment;
}

function presenceSummary(account, address) {
    function presenceDegree(stanza) {
        var weight;
        if(stanza.@type == undefined && stanza.show == undefined)
            weight = 4;
        else if(stanza.@type == 'unavailable')
            weight = 0;
        else
            switch(stanza.show.toString()) {
            case 'chat': weight = 5; break;
            case 'dnd':  weight = 3; break;
            case 'away': weight = 2; break;
            case 'xa':   weight = 1; break;
            default:
                throw new Error('Unexpected. (' + stanza.toXMLString() + ')');
            }
        return weight;
    }

    var presences;
    if(account && address)
        presences = cache.fetch({
            event     : 'presence',
            direction : 'in',
            session   : { name: account },
            stanza    : function(s) { return JID(s.@from).address == address; }
            });
    else 
        presences = cache.fetch({
            event     : 'presence',
            direction : 'out',
            stanza    : function(s) { return s.ns_muc::x == undefined && s.@to == undefined; }
            });

    presences.sort(
        function(a, b) {
            return presenceDegree(b.stanza) - presenceDegree(a.stanza);
        });

    if(presences[0])
        return presences[0];
    else {
        var synthPresence;
        if(address)
            synthPresence = {
                session   : { name: account },
                account   : account,
                direction : 'in',
                stanza    : <presence from={address} type="unavailable"/>
            }
        else
            synthPresence = {
                session   : { name: account },
                account   : account,
                direction : 'out',
                stanza    : <presence type="unavailable"/>
            }
        return synthPresence;
    }
}


// HYBRID-APP SUPPORT
// ----------------------------------------------------------------------

function enableContentDocument(panel, account, address, type, createSocket) {
    if(panel.hasAttribute('account') &&
       panel.getAttribute('account') != account)
        throw new Error('Content panel already attached to different account. (' + account + ')');

    if(panel.hasAttribute('address') &&
       panel.getAttribute('address') != address)
        throw new Error('Contact panel already attached to different address. (' + address + ')');

    if(panel.xmppChannel) {
        log('Content panel already connected.');
        return;
    }

    var appDoc = panel.contentDocument;
    if(createSocket) 
        for each(var socketPartId in ['xmpp-incoming', 'xmpp-outgoing'])
            if(!appDoc.getElementById(socketPartId)) {
                var socketPart = appDoc.createElement('div');
                socketPart.setAttribute('style', 'display: none;');
                socketPart.setAttribute('id', socketPartId);
                appDoc.documentElement.appendChild(socketPart);
            }
    
    if(!(appDoc.getElementById('xmpp-incoming') &&
         appDoc.getElementById('xmpp-outgoing'))) {
        log('Missing xmpp sockets in shared application.');
        return;
    }
        

    function gotDataFromPage(stanza) {
        var caps = {
            set_type     : true,
            set_resource : true,
            set_address  : /^(file|chrome):\/\//.test(panel.currentURI.spec),
            track_iq     : /^(file|chrome):\/\//.test(panel.currentURI.spec)
        }

        if(stanza.@type == undefined && stanza.name() == 'message')
            stanza.@type = type;
        else if(caps.set_type)
            true;
        else
            throw new Error('Shared application tried to set message type.');

        if(stanza.@to == undefined)
            stanza.@to = address;
        else if(/^\/.+$/.test(stanza.@to.toString()) && caps.set_resource)
            stanza.@to = address + stanza.@to;
        else if(caps.set_address)
            true;
        else
            throw new Error('Shared application does not have enough privileges for requested operation');

        if(stanza.@from != undefined)
            throw new Error('Shared application tried to set @from attribute in outgoing stanza.');

        var replyHandler;
        if(stanza.localName() == 'iq' &&
           JID(stanza.@to).address != address &&
           caps.track_iq) {
            // When tracking IQs, remove id as set by remote
            // application by remember it, so that it can be set again
            // on the response.
            
            var requestId = stanza.@id.toString();
            delete stanza.@id;

            replyHandler = function(reply) {
                var s = reply.stanza.copy();
                
                if(requestId)
                    s.@id = requestid;
                else
                    delete s.@id;
                
                gotDataFromXMPP(s);
            };
        }

        send(account, stanza, replyHandler);
    }

    function gotDataFromXMPP(stanza) {
        appDoc.getElementById('xmpp-incoming').textContent =
            stanza.toXMLString();
    }

    // Assign the panel to the {account, address} pair.

    panel.setAttribute('account', account);
    panel.setAttribute('address', address);
    panel.contentWindow.addEventListener('unload', function(event) {
        if(event.target == panel.contentDocument) 
            disableContentDocument(panel);
    }, true);
    
    // Presence from contact

    var contactPresence = presenceSummary(account, address);

    // MUC presence is the presence stanza we used to join the room
    // (if we are joining a room).

    var mucPresences;
    if(type == 'groupchat') {
        var mucPresencesOut =
            cache.all(q()
                      .event('presence')
                      .direction('out')
                      .account(account)
                      .to(address)); 
       var mucPresencesIn = 
            cache.all(q()
                      .event('presence')
                      .direction('in')
                      .account(account)
                      .from(address));
        mucPresences = mucPresencesIn.concat(mucPresencesOut);
    }

    // Wire data coming from application to XMPP

    appDoc.getElementById('xmpp-outgoing').addEventListener(
        'DOMNodeInserted', function(event) {
            XML.prettyPrinting = false;
            XML.ignoreWhitespace = false;
            gotDataFromPage(new XML(event.target.textContent));
        }, false);

    // Select subset of XMPP traffic to listen to
    
    var channel = createChannel();
    panel.xmppChannel = channel;

    channel.on({
        direction : 'in',
        account   : account,
        stanza    : function(s) { return s != undefined && (JID(s.@from).address == address); }
    }, function(event) { gotDataFromXMPP(event.stanza); });
    
    if(type != 'groupchat')
        channel.on({
            direction : 'out',
            event     : 'message',
            account   : account,
            stanza    : function(s) { return JID(s.@to).address == address; }
        }, function(message) { gotDataFromXMPP(message.stanza); });


    gotDataFromXMPP(rosterSegment(account, address));

    if(contactPresence)
        gotDataFromXMPP(contactPresence.stanza);
    else
        gotDataFromXMPP(<presence from={address} type="unavailable"/>)
    if(mucPresences)
        mucPresences.forEach(
            function(mucPresence) { gotDataFromXMPP(mucPresence.stanza); });
}

function disableContentDocument(panel) {
    panel.removeAttribute('address');
    panel.removeAttribute('account');
    panel.xmppChannel.release();
    delete panel.xmppChannel;
}


// INTERNALS
// ----------------------------------------------------------------------

function _promptAccount(jid) {        
    var params = {
        confirm: false,
        jid: jid,
        password: undefined
    };
    window.openDialog(
        'chrome://xmpp4moz/content/ui/signon.xul',
        'xmpp-signon', 'modal,centerscreen',
        params);
    return params;
}

function _up(account, continuation) {
    var jid, password, host, port, ssl;
    if(account) {
        jid = account.jid;
        password = account.password;
        host = account.connectionHost;
        port = account.connectionPort;
        ssl = (account.connectionSecurity == undefined ||
               account.connectionSecurity == 1);
    }

    if(!((jid && password) || (jid && this.isUp(jid)))) {
        var userInput = this._promptAccount(jid);

        if(userInput.confirm) {
            password = userInput.password;
            jid = userInput.jid;
        }
    }

    if(this.isUp(jid) && continuation)
        continuation(jid);
    else if(jid && password) {
        open(jid, {host: host, port: port, ssl: ssl},
             function() {
                 send(
                     jid,
                     <iq to={JID(jid).hostname} type="set">
                     <query xmlns="jabber:iq:auth">
                     <username>{JID(jid).username}</username>
                     <password>{password}</password>
                     <resource>{JID(jid).resource}</resource>
                     </query></iq>,
                     function(reply) {
                         if(reply.stanza.@type == 'result') {
                             send(jid,
                                  <iq type="get">
                                  <query xmlns="jabber:iq:roster"/>
                                  </iq>, function() {
                                      send(jid, <presence/>);
                                      if(continuation)
                                          continuation(jid);
                                  })
                         }
                     });
             });        
    }
}

function _send(jid, stanza, handler) {
    var replyObserver;
    if(handler)
        replyObserver = {
            observe: function(replyStanza, topic, sessionName) {
                handler({
                    session: { name: sessionName }, // XXX hack
                    stanza: dom2xml(replyStanza)
                    });
            }
        };

    var settings = XML.settings();
    XML.prettyPrinting = false;
    XML.ignoreWhitespace = false;
    service.send(jid, asDOM(stanza), replyObserver);
    XML.setSettings(settings);
}

function AccountWrapper(key) {
    this.key = key;
}

AccountWrapper.prototype = {
    _read: function(preference) {
        var prefReaders = ['getCharPref', 'getIntPref', 'getBoolPref'];
        for each(var reader in prefReaders) {
            try {
                return pref[reader]('account.' + this.key + '.' + preference);
            } catch(e) {}
        }
        return undefined;
    },

    get jid() {
        return this.address + '/' + this.resource;
    }
};

['address', 'password', 'resource',
 'autoLogin', 'connectionHost', 'connectionPort', 'connectionSecurity'
    ].forEach(function(property) {
                  AccountWrapper.prototype.__defineGetter__(
                      property, function() {
                          return this._read(property);
                      });
              });

this.__defineGetter__(
    'accounts', function() {
        var keys = uniq(
            pref
            .getChildList('account.', {})
            .map(
                function(item) {
                    try {
                        return item.split('.')[1];
                    } catch(e) {
                        // Cases where item.split() would result in
                        // an error and prevent accounts from being
                        // read were reported.  No additional
                        // information is available, though, so we
                        // just catch the exception and report the
                        // error to the console.
                        Cu.reportError(e);
                        return undefined;
                    }})
            .filter(
                function(key) {
                    return key != undefined;
                }));

        return keys.map(
            function(key) {
                return new AccountWrapper(key);
            });
    });

function getAccountByJid(jid) {
    var result;
    accounts.forEach(
        function(account) {
            if(result)
                return;
            if(account.jid == jid)
                result = account;
        });
    return result;
}

function getAccountByKey(key) {
    var result;
    accounts.forEach(
        function(account) {
            if(result)
                return;
            if(account.key == key)
                result = account;
        });
    return result;
}

function asDOM(object) {
    var _ = arguments.callee;
    _.parser = _.parser || Cc['@mozilla.org/xmlextras/domparser;1'].getService(Ci.nsIDOMParser);

    var element;    
    switch(typeof(object)) {
    case 'xml':
        element = _.parser
        .parseFromString(object.toXMLString(), 'text/xml')
        .documentElement;
        break;
    case 'string':
        element = _.parser
        .parseFromString(object, 'text/xml')
        .documentElement;
        break;
    default:
        // XXX use xpcom exception
        throw new Error('Argument error. (' + typeof(object) + ')');
    }
    
    return element;
}


// DEVELOPER UTILITIES
// ----------------------------------------------------------------------

function deprecation(msg) {
    var frame = Components.stack.caller;
    
    dump('xmpp4moz :: DEPRECATION NOTICE :: "' + msg + '" in: \n');
    while(frame) {
        dump('  ' + frame + '\n');
        frame = frame.caller
    }
}

function getStackTrace() {
    var frame = Components.stack.caller;
    var str = "<top>";

    while (frame) {
        str += '\n' + frame;
        frame = frame.caller;
    }

    return str;
}

function log(msg) {
    var _ = arguments.callee;
    _.console = _.console ||
        Cc['@mozilla.org/consoleservice;1'].getService(Ci.nsIConsoleService);

    _.console.logStringMessage('xmpp4moz: ' + msg);
}
