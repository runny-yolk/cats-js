let fuseObj = Object.assign;

function flatten(arr){
    var rtn = [];
    for(let i = 0; i < arr.length; i++){
        let x = arr[i];
        if(Array.isArray(x)) rtn = rtn.concat( flatten(x) );
        else if(x !== undefined && x !== null) rtn.push(x);
    }
    return rtn;
}
function rmvVal(arr, x){
    let ind = arr.indexOf(x);
    if(ind > -1) arr.splice(arr.indexOf(x), 1);
}
function styleStr(obj, pre = ''){
    let rtn = '';
    for(let k in obj){
        let prop = k.replace(/[A-Z]/g, function(m){
            return '-'+m.toLowerCase();
        });
        if(typeof obj[k] === 'object') rtn += styleStr(obj[k], prop+'-');
        rtn += pre+prop+':'+obj[k];
    }
    return rtn;
}
function cloneObj(x){
    let xt = typeof x;
    if(xt === 'object') {
        if(x === null) return x;
        else if(Array.isArray(x)) return x.map(cloneObj);
        else if(x.__proto__.__proto__ !== null) throw new Error('can only clone plain objs and arrays');
        else {
            let rtn = {};
            for(let k in x) rtn[k] = cloneObj(x[k]);
            return rtn; 
        }
    }
    else return x;
}
function isProm(x){
    return x instanceof Promise;
}


class Vele {
    constructor(tag, attrs, kids){
        return fuseObj(this, {
            tag, attrs, kids,
            isVDOM: true,
            isVele: true
        });
    }

    runf(name, args){
        for(let k of this.kids) if(k.isVDOM) k.runf(name, args);
    }
    remove(){
        this.runf('Unmounting')
        this.real.remove();
        this.runf('Unmounted')
    }
    mkReal(){
        if(this.real) return this.real;
        
        let {tag, attrs, kids} = this;

        let real = document.createElement(tag);

        for(let k in attrs){
            let v = attrs[k];
            let vt = typeof v;

            if(vt === 'string') real.setAttribute(k, v);
            else if(vt === 'function') real.addEventListener(k, v);
        }

        for(let k of kids) real.appendChild( realNode(k) );

        this.real = real;
        return real;
    }
    get(key){
        if(typeof key !== 'string') throw new TypeError('key must be str');
        if(!this.real) return;
        return this.real[key];
    }
    run(key){
        if(!this.real) return;
        let f = this.get(key);
        if(typeof f !== 'function') return console.warn('not a function');
        return f.apply(this.real, Array.prototype.slice.call(arguments, 1));
    }
    clone(){
        return new Vele(
            this.tag,
            cloneObj(this.attrs),
            this.kids.map(k => {
                if(k.isVele) return k.clone();
                if(k.isItem) throw new Error("Can't clone items");
                return k;
            })
        );
    }
}

class Item {
    constructor(con, props = {}, cats){
        if(typeof props !== 'object' || props === null) throw new TypeError('props must be object');
        return fuseObj(this, {
            con, props, cats,
            inited: false,
            isVDOM: true,
            isItem: true,
            mounted: false
        });
    }
    
    runf(name, args, cascade = true){
        if(name === 'NewProps') this.props = args[0];

        if((name === 'Mounted' || name === 'Mounting') && this.mounted) return;
        if((name === 'Unmounted' || name === 'Unmounting') && !this.mounted) return;

        if(name === 'Mounted') this.mounted = true;
        if(name === 'Unmounted') {
            uinfo.rmvItem(this);
            this.mounted = false;
        }

        if(this.meta && typeof this.meta[name] === 'function') this.meta[name].apply(this.meta, args);
        if(cascade && this.vdom) this.vdom.runf(name, args);
    }
    remove(){
        this.runf('Unmounting')
        this.vdom.remove();
        this.runf('Unmounted')
    }
    mkReal(){
        if(!this.inited) this.init();
        let rtn = this.vdom.mkReal();
        return rtn;
    }
    refreshVDOM(){
        if(!this.inited) return;

        let old = this.vdom;

        if(this.simpleItem) this.vdom = this.con(this.props, this.update);
        if(this.funItem) this.vdom = this.meta.Render();

        this.handlePromise();

        return old;
    }
    update(){
        if(!this.inited) return;
        let old = this.refreshVDOM();
        if(this.mounted) diffele(old, this.vdom);
    }
    handlePromise(){
        if(!isProm(this.vdom)) return;

		// TODO: method to change what gets displayed as placeholder
        let promLayer = new Item(() => _('', '...'), this.props).init();
        promLayer.prom = this.vdom;

        this.vdom = promLayer;

        promLayer.resolved = false;
        promLayer.prom.then(result => {
            promLayer.resolved = true;
            if(typeof result === 'function') result = new Item(result, this.props).init();
            if(!result.isVDOM) throw new Error('Promises in VDOM must produce VDOM');
            promLayer.con = () => result;
            promLayer.update();
        });
    }
    init(){
        if(this.inited) {
            this.refreshVDOM();
            uinfo.add(this);
            return this;
        }
        
        this.update = this.update.bind(this);

        let {con, props} = this;
        let obj;

        try {
            obj = new con(props, this.update, true);
        } catch(err){
            if(err.message === "con is not a constructor") obj = con(props, this.update, true);
            else throw err;
        }

        if(typeof obj.Render === 'function') {
            fuseObj(this, {
                funItem: true,
                meta: obj
            });
            this.runf('NewProps', [props], false);
            this.vdom = this.meta.Render();
        }
        else if(obj.isVDOM || isProm(obj)) fuseObj(this, {
            simpleItem: true,
            vdom: obj
        })
        else throw new TypeError('item constructor must return Promise, vele or obj with Render function');

        this.handlePromise();

        this.cats = flatten([this.cats, obj.cats]);
        uinfo.add(this);

        this.inited = true;
        return this;
    }
}

function realNode(x){
    if(typeof x === 'string') return document.createTextNode(x);
    if(x instanceof Node) return x.cloneNode(true);
    if(x.isVDOM) return x.mkReal();
}
function diffele(oldv, newv){
    if(oldv === newv) return;
    if(oldv.isItem && !oldv.inited) throw new Error('cannot diff uninitialised item');
    
    if(!oldv.isVele || !newv.isVele){
        if(oldv.funItem && newv.isItem && oldv.con === newv.con){
            oldv.runf('NewProps', [newv.props], false);
            newv.runf('Unmounting');
            oldv.update();
            newv.runf('Unmounted');
            delete newv.simpleItem;
            fuseObj(newv, oldv);
        }
        else if (oldv.isVDOM && newv.isVDOM) {
            if(newv.isItem && !newv.inited) newv.init();
            oldv.runf('Unmounting');
            newv.runf('Mounting');
            diffele(oldv.vdom || oldv, newv.vdom || newv);
            newv.runf('Mounted');
            oldv.runf('Unmounted');
        }
        return;
    }


    let real = oldv.real;
    if(!real) return console.warn('cannot diff vele without real');

    if(newv.tag !== oldv.tag) {
        newv.mkReal();
        oldv.runf('Unmounting');
        newv.runf('Mounting');
        real.replaceWith(newv.real);
        newv.runf('Mounted');
        oldv.runf('Unmounted');
        return;
    }

    for(let k in oldv.attrs){
        if(newv.attrs[k] === undefined || typeof newv.attrs[k] !== typeof oldv.attrs[k]) {
            if(k === 'value') real.value = '';
            else if(typeof oldv.attrs[k] === 'string') real.removeAttribute(k);
            else if(typeof oldv.attrs[k] === 'function') real.removeEventListener(k, oldv.attrs[k]);
        }
    }
    
    for(let k in newv.attrs){
        if(newv.attrs[k] === oldv.attrs[k] && k !== 'value') continue;
        
        if(typeof newv.attrs[k] === 'string') {
            if(k === 'value') real.value = newv.attrs[k];
            real.setAttribute(k, newv.attrs[k]);
        }
        else if(typeof newv.attrs[k] === 'function') {
            real.removeEventListener(k, oldv.attrs[k]);
            real.addEventListener(k, newv.attrs[k]);
        }
    }

    if(newv.attrs.value === undefined && typeof real.value === 'string') real.value = '';

    let realKids = real.childNodes;
    for(let i = 0; i < newv.kids.length; i++){
        let n = newv.kids[i],
            o = oldv.kids[i];

        if(i >= oldv.kids.length) {
            let realn = realNode(n);
            if(n.isVDOM) n.runf('Mounting');
            real.appendChild(realn);
            if(n.isVDOM) n.runf('Mounted');
            continue;
        }

        if(n === o) continue;

        
        if(typeof n === 'string' && typeof o === 'string') realKids[i].textContent = n;
        else if (o.isVDOM && n.isVDOM) {
            if(o.funItem && n.isItem && o.con === n.con){
                if(n.inited) n.runf('Unmounting');
                o.runf('NewProps', [n.props], false);
                o.update();
                if(n.inited) n.runf('Unmounted');
                newv.kids[i] = o;
            }
            else diffele(o, n);
        }
        else {
            let realn = realNode(n);
            if(o.isVDOM) o.runf('Unmounting');
            if(n.isVDOM) n.runf('Mounting'); 
            realKids[i].replaceWith(realn);
            if(n.isVDOM) n.runf('Mounted');
            if(o.isVDOM) o.runf('Unmounted');
        }
    }

    let l = newv.kids.length;
    while(realKids[l]) {
        if(oldv.kids[l].isVDOM) oldv.kids[l].runf('Unmounting');
        realKids[l].remove();
        if(oldv.kids[l].isVDOM) oldv.kids[l].runf('Unmounted');
    }

    newv.real = real;
}


window.uinfo = {
    items: {},
    cats: {},
    process(cats, except){
        if(cats === 'allCats') cats = Object.keys(this.cats);

        if(typeof cats === 'string') cats = [cats];
        if(!Array.isArray(cats)) throw new TypeError('cats must be arr or str');

        if(typeof except === 'string') except = [except];
        if(Array.isArray(except)) for(let e of except) rmvVal(cats, e);

        return cats;
    },
    add(item){
        if(!item.cats.length) return;

        let id;
        if(item.id) id = item.id;
        else {
            id = Math.random().toString(32).slice(2);
            item.id = id;
        }

        if(this.items[id]) return;
        this.items[id] = item;

        for(let c of item.cats){
            if(c === 'allCats') continue;
            if(!this.cats[c]) this.cats[c] = [];
            this.cats[c].push(id);
        }
    },
    rmvItem(item){
        if(item.id) {
            delete this.items[item.id];
            for(let c of item.cats) rmvVal(this.cats[c], item.id);
        }
    },
    rmv(cats, except){
        cats = this.process(cats, except);

        for(let c of cats) {
            if(!Array.isArray(this.cats[c])) continue;
            for(let id of this.cats[c]) delete this.items[id];
            delete this.cats[c];
        }
    },
    update(cats, except){
        cats = this.process(cats, except);

        for(let c of cats) if(Array.isArray(this.cats[c])) for(let id of this.cats[c]) this.items[id].update();
    }
}


function isVeleChild(x){
    return x !== undefined && (x === null || Array.isArray(x) || x.nodeType || x.isVDOM || typeof x === 'string')
}
export default function _(arg0){
    let args = arguments, con, str;

    if(typeof arg0 === 'function') con = arg0;
    else if(typeof arg0 === 'string') str = arg0;
    else if(isProm(arg0)) return new Item(() => arg0, args[1], args[2]);
    else throw new TypeError('arg0 must be str, function, or promise');

    if(str && typeof _.comps[str] === 'function') con = _.comps[str];

    if(con) return new Item(con, args[1], args[2]);

    let kids, attrs = {};
    if( isVeleChild(args[1]) ) kids = Array.from(args).slice(1);
    else {
        if(typeof args[1] === 'object') attrs = args[1];
        kids = Array.from(args).slice(2);
    }

    // parsing string into tag name, id, and classes
    var tag, id, classes = [];
    str = str.match(/[#.]?[^#.]+/g);
    if(Array.isArray(str)) str.forEach(function(x){
        if(x[0] === '.') classes.push(x.slice(1));
        else if(x[0] === '#') id = x.slice(1);
        else tag = x;
    });

    classes = classes.join(' ');
    if(classes){
        if(typeof attrs.class === 'string') attrs.class += ' '+classes;
        else attrs.class = classes;
    }
    
    if(!attrs.id) attrs.id = id;

    tag = tag || 'div';
    
    if(typeof attrs.style === 'object') attrs.style = styleStr(attrs.style);

    if(tag === 'textarea'){
        if(kids.length){
            let value = '';
            for(let x of kids) if(typeof x === 'string') value += x;
            attrs.value = value;
            kids = [value];
        }
        else if(typeof attrs.value === 'string'){
            kids = [attrs.value];
        }
    }

    return new Vele(tag, attrs, flatten(kids));
}
_.comps = {};
_.update = uinfo.update.bind(uinfo);
_.render = function(target, pos, vdom){
    let shortPos = {
        before:'beforebegin',
        start:'afterbegin',
        end:'beforeend',
        after:'afterend'
    };
    if(shortPos[pos]) pos = shortPos[pos];

    if(!Array.isArray(vdom)) vdom = [vdom];
	
    vdom = flatten(vdom);
    
    for(let v of vdom) {
        if(v.isVDOM){
            let real = v.mkReal();
            v.runf('Mounting');
            target.insertAdjacentElement(pos, real);
            v.runf('Mounted');
        }
        else target.insertAdjacentElement(pos, realNode(v));
    }
    return vdom;
}
_.HTML = function(html, rtnList, safety = true){
    let temp = document.createElement('div');
    temp.innerHTML = html;
    if(safety) temp.querySelectorAll('script, style').forEach(ele => ele.remove());

    if(rtnList) return Array.from(temp.childNodes);
    else return temp.children[0];
}
_.lazy = function(obj){
    if(typeof obj !== 'object') throw new TypeError('obj must be object');
    for(let name in obj){
        if(_.comps[name]) continue;
        _.comps[name] = (props, cats) => _( importer(obj[name]), props, cats );
    }
}
