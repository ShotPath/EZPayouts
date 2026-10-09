/* ---------- <ez-select>: a custom dropdown that replaces native <select>
   everywhere on the site, since the browser's own picker UI can't be
   themed and breaks the dark cyber-neon look.

   Drop-in compatible with how every page already uses <select>:
     - set options via .innerHTML = '<option value="x">Label</option>...'
       or el.appendChild(optionEl) — both just mutate the element's light-DOM
       children, which a MutationObserver picks up and re-renders from.
     - read/write the current choice via el.value (get/set), exactly like a
       real <select> — setting .value does NOT fire "change" (same as native).
     - el.addEventListener("change", fn) fires when the user actually picks
       an option through the UI.
     - <optgroup label="..." disabled> and <option disabled> are both
       respected (used by the Compare page's "Coming Soon" firms).
   No page-specific JS needs to change beyond swapping the <select> tag name
   to <ez-select> in the markup. ---------- */
(function(){
  "use strict";
  if (!window.customElements || customElements.get("ez-select")) return;

  var STYLE =
    ':host{ display:inline-block; position:relative; }' +
    '.trigger{' +
      'display:flex; align-items:center; justify-content:space-between; gap:10px;' +
      'width:100%; min-width:120px; padding:9px 12px; border-radius:12px;' +
      'background:#0d101d; border:1px solid #161c33; color:#eef1fb;' +
      'font-family:"IBM Plex Mono","SFMono-Regular",Consolas,monospace; font-size:12.5px;' +
      'cursor:pointer; user-select:none; text-align:left;' +
      'transition:border-color .15s, box-shadow .15s;' +
    '}' +
    '.trigger:hover{ border-color:#232c54; }' +
    ':host([open]) .trigger{ border-color:#3262f6; box-shadow:0 0 0 1px rgba(50,98,246,0.3); }' +
    ':host([disabled]) .trigger{ opacity:0.5; cursor:not-allowed; }' +
    '.trigger-label{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }' +
    '.chev{ width:12px; height:12px; flex:none; fill:none; stroke:#848ca3; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; transition:transform .15s; }' +
    ':host([open]) .chev{ transform:rotate(180deg); stroke:#7c9bff; }' +
    '.panel{' +
      'position:absolute; top:calc(100% + 8px); left:0; min-width:100%; width:max-content; max-width:280px; z-index:200;' +
      'background:#0c0e17; border:1px solid #202b54; border-radius:12px; padding:6px;' +
      'box-shadow:0 10px 30px rgba(50,98,246,0.15), 0 20px 44px -18px rgba(0,0,0,0.8);' +
      'max-height:280px; overflow-y:auto;' +
    '}' +
    '.panel.align-right{ left:auto; right:0; }' +
    '.panel[hidden]{ display:none; }' +
    '.group-label{' +
      'padding:8px 10px 4px; font-family:"IBM Plex Mono",monospace; font-size:9.5px; font-weight:700;' +
      'letter-spacing:0.08em; text-transform:uppercase; color:#565d75;' +
    '}' +
    '.opt{' +
      'display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer;' +
      'font-family:"IBM Plex Mono",monospace; font-size:12.5px; color:#c7cce0; white-space:nowrap;' +
      'position:relative; transition:background .12s, color .12s, text-shadow .12s;' +
    '}' +
    '.opt:hover:not(.disabled){ background:rgba(50,98,246,0.14); color:#ffffff; text-shadow:0 0 10px rgba(80,140,255,0.55); }' +
    '.opt.active{ background:#141d3a; color:#ffffff; padding-left:16px; }' +
    '.opt.active::before{' +
      'content:""; position:absolute; left:4px; top:5px; bottom:5px; width:2.5px; border-radius:2px;' +
      'background:#3262f6; box-shadow:0 0 8px rgba(50,98,246,0.75);' +
    '}' +
    '.opt.disabled{ color:#454c60; cursor:not-allowed; }' +
    '.opt-empty{ padding:10px; font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:#565d75; }';

  function svgChevron(){
    return '<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6"/></svg>';
  }

  function EzSelect(){
    var self = Reflect.construct(HTMLElement, [], EzSelect);
    self._open = false;
    self._value = null;
    self._groups = []; // [{label, disabled, options:[{value,label,disabled}]}]

    var shadow = self.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<style>' + STYLE + '</style>' +
      '<button type="button" class="trigger" part="trigger"><span class="trigger-label"></span>' + svgChevron() + '</button>' +
      '<div class="panel" hidden role="listbox"></div>';
    self._trigger = shadow.querySelector(".trigger");
    self._label = shadow.querySelector(".trigger-label");
    self._panel = shadow.querySelector(".panel");

    self._onTriggerClick = function(e){
      e.stopPropagation();
      if (self.hasAttribute("disabled")) return;
      self._open ? self._close() : self._openPanel();
    };
    self._onDocClick = function(e){
      if (e.composedPath && e.composedPath().indexOf(self) !== -1) return;
      self._close();
    };
    self._onKeydown = function(e){
      if (e.key === "Escape") self._close();
    };
    self._onMutate = function(){ self._syncFromDom(); };
    self._mo = new MutationObserver(self._onMutate);

    self._trigger.addEventListener("click", self._onTriggerClick);
    return self;
  }
  EzSelect.prototype = Object.create(HTMLElement.prototype);
  EzSelect.prototype.constructor = EzSelect;

  EzSelect.prototype.connectedCallback = function(){
    this._syncFromDom();
    document.addEventListener("click", this._onDocClick);
    document.addEventListener("keydown", this._onKeydown);
    this._mo.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled", "label"] });
  };
  EzSelect.prototype.disconnectedCallback = function(){
    document.removeEventListener("click", this._onDocClick);
    document.removeEventListener("keydown", this._onKeydown);
    this._mo.disconnect();
  };

  function optData(opt){
    return {
      value: opt.hasAttribute("value") ? opt.getAttribute("value") : (opt.textContent || "").trim(),
      label: (opt.textContent || "").trim(),
      disabled: opt.hasAttribute("disabled"),
      selected: opt.hasAttribute("selected")
    };
  }

  EzSelect.prototype._readGroups = function(){
    var groups = [];
    var current = null;
    function pushLoose(){
      if (current && current.options.length) groups.push(current);
      current = null;
    }
    Array.prototype.forEach.call(this.children, function(child){
      var tag = child.tagName;
      if (tag === "OPTGROUP"){
        pushLoose();
        var g = { label: child.getAttribute("label") || "", disabled: child.hasAttribute("disabled"), options: [] };
        Array.prototype.forEach.call(child.children, function(opt){
          if (opt.tagName !== "OPTION") return;
          var d = optData(opt);
          if (g.disabled) d.disabled = true;
          g.options.push(d);
        });
        groups.push(g);
      } else if (tag === "OPTION"){
        if (!current) current = { label: null, disabled: false, options: [] };
        current.options.push(optData(child));
      }
    });
    pushLoose();
    return groups;
  };

  EzSelect.prototype._syncFromDom = function(){
    var groups = this._readGroups();
    this._groups = groups;
    var allOptions = [];
    groups.forEach(function(g){ allOptions = allOptions.concat(g.options); });

    var selectedExplicit = allOptions.filter(function(o){ return o.selected; });
    var nextValue;
    if (selectedExplicit.length){
      nextValue = selectedExplicit[selectedExplicit.length - 1].value;
    } else if (this._value != null && allOptions.some(function(o){ return o.value === this._value; }, this)){
      nextValue = this._value;
    } else if (allOptions.length){
      nextValue = allOptions[0].value;
    } else {
      nextValue = null;
    }
    this._value = nextValue;
    this._renderPanel();
    this._renderTrigger();
  };

  EzSelect.prototype._renderTrigger = function(){
    var self = this;
    var match = null;
    this._groups.forEach(function(g){
      g.options.forEach(function(o){ if (o.value === self._value) match = o; });
    });
    this._label.textContent = match ? match.label : "";
  };

  EzSelect.prototype._renderPanel = function(){
    var self = this;
    if (!this._groups.length){
      this._panel.innerHTML = '<div class="opt-empty">No options</div>';
      return;
    }
    var html = "";
    this._groups.forEach(function(g){
      if (g.label) html += '<div class="group-label">' + escapeHtml(g.label) + '</div>';
      g.options.forEach(function(o){
        var cls = ["opt"];
        if (o.disabled) cls.push("disabled");
        if (o.value === self._value) cls.push("active");
        html += '<div class="' + cls.join(" ") + '" data-value="' + escapeAttr(o.value) + '" role="option" aria-selected="' + (o.value === self._value) + '">' + escapeHtml(o.label) + '</div>';
      });
    });
    this._panel.innerHTML = html;
    this._panel.querySelectorAll(".opt:not(.disabled)").forEach(function(row){
      row.addEventListener("click", function(e){
        e.stopPropagation();
        self._select(row.getAttribute("data-value"));
      });
    });
  };

  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s){ return escapeHtml(s); }

  EzSelect.prototype._select = function(value){
    var changed = value !== this._value;
    this._value = value;
    this._renderTrigger();
    this._renderPanel();
    this._close();
    if (changed) this.dispatchEvent(new Event("change", { bubbles: true }));
  };

  EzSelect.prototype._openPanel = function(){
    this._open = true;
    this.setAttribute("open", "");
    this._panel.hidden = false;
    // Flip to the left edge of the trigger if the panel would overflow the viewport.
    this._panel.classList.remove("align-right");
    var rect = this._panel.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) this._panel.classList.add("align-right");
  };
  EzSelect.prototype._close = function(){
    if (!this._open) return;
    this._open = false;
    this.removeAttribute("open");
    this._panel.hidden = true;
  };

  Object.defineProperty(EzSelect.prototype, "value", {
    get: function(){ return this._value == null ? "" : this._value; },
    set: function(v){
      this._value = v;
      this._renderTrigger();
      this._renderPanel();
    }
  });

  // Options are usually set via `el.innerHTML = '<option>...'` or
  // `el.appendChild(optionEl)`, then the value is read back immediately on
  // the very next line (e.g. Compare's render() right after building each
  // slot's options). MutationObserver callbacks are microtask-deferred, so
  // relying on it alone left `.value` stale/empty for that first synchronous
  // read. Overriding these two entry points to resync immediately closes
  // that race; the MutationObserver stays on as a catch-all for any other
  // mutation path (removeChild, replaceChildren, etc.).
  var nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(EzSelect.prototype, "innerHTML", {
    get: function(){ return nativeInnerHTML.get.call(this); },
    set: function(html){
      nativeInnerHTML.set.call(this, html);
      this._syncFromDom();
    }
  });
  EzSelect.prototype.appendChild = function(node){
    var result = HTMLElement.prototype.appendChild.call(this, node);
    this._syncFromDom();
    return result;
  };

  customElements.define("ez-select", EzSelect);
})();
