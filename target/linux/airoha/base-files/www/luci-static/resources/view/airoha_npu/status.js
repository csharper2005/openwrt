'use strict';
'require view';
'require poll';
'require rpc';
'require ui';

var callNpuStatus = rpc.declare({ object: 'luci.airoha_npu', method: 'getStatus' });
var callPpeEntries = rpc.declare({ object: 'luci.airoha_npu', method: 'getPpeEntries' });
var callTokenInfo = rpc.declare({ object: 'luci.airoha_npu', method: 'getTokenInfo' });
var callFrameEngine = rpc.declare({ object: 'luci.airoha_npu', method: 'getFrameEngine' });
var callSetGovernor = rpc.declare({ object: 'luci.airoha_npu', method: 'setGovernor', params: ['governor'] });
var callSetMaxFreq = rpc.declare({ object: 'luci.airoha_npu', method: 'setMaxFreq', params: ['freq'] });
var callSetOverclock = rpc.declare({ object: 'luci.airoha_npu', method: 'setOverclock', params: ['freq_mhz'] });

/*
 * Every colour below comes from the custom properties LuCI themes export,
 * with a literal fallback for a theme that does not define one. That is what
 * makes the page follow the active theme, including its dark mode and its
 * palette variants, without this file knowing which theme is running.
 *
 * Text that sits on a filled surface takes its ink from the matching
 * --on-*-color, because a hardcoded white fails against half of the dark
 * fills, and a chip with no status colour is drawn as an outline rather than
 * invented as a filled pair the tier makes no promise about. Nothing is
 * declared on :root and every selector carries the package prefix, so the
 * sheet cannot reach another application's page.
 */
var viewCSS = '\
.airoha-npu-card{background:var(--background-color-high,#fff);border:1px solid var(--border-color-medium,#d0d0d0);border-radius:8px;padding:14px;transition:border-color .3s}\
.airoha-npu-card-active{border-color:var(--primary-color-medium,#2196f3)}\
.airoha-npu-title{font-weight:bold;font-size:14px;color:var(--text-color-highest,#111)}\
.airoha-npu-muted{color:var(--text-color-medium,#666)}\
.airoha-npu-text{color:var(--text-color-high,#222)}\
.airoha-npu-label{font-size:11px;color:var(--text-color-medium,#666)}\
.airoha-npu-ok{color:var(--success-color-medium,#4caf50)}\
.airoha-npu-warn{color:var(--warn-color-medium,#ff9800)}\
.airoha-npu-error{color:var(--error-color-medium,#f44336)}\
.airoha-npu-idle{color:var(--text-color-medium,#666)}\
.airoha-npu-dot{width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block}\
.airoha-npu-chip{padding:1px 7px;border-radius:3px;font-size:10px;font-weight:600;text-transform:uppercase}\
.airoha-npu-chip-on{background:var(--success-color-high,#2e7d32);color:var(--on-success-color,#fff)}\
.airoha-npu-chip-npu{background:var(--primary-color-high,#1565c0);color:var(--on-primary-color,#fff)}\
.airoha-npu-chip-off{background:none;border:1px solid var(--border-color-medium,#d0d7de);color:var(--text-color-medium,#666)}\
.airoha-npu-bar-track{background:var(--border-color-medium,#d0d7de);border-radius:4px;overflow:hidden}\
.airoha-npu-bar-fill{height:100%;border-radius:4px;transition:width .5s}\
.airoha-npu-bar-ok{background:var(--success-color-high,#2e7d32)}\
.airoha-npu-bar-warn{background:var(--warn-color-high,#e65100)}\
.airoha-npu-bar-error{background:var(--error-color-high,#c62828)}\
.airoha-npu-bar-idle{background:var(--border-color-high,#9aa4ad)}\
.airoha-npu-freq-value{font-weight:bold;font-size:13px;color:var(--text-color-highest,#111);margin-bottom:4px}\
.airoha-npu-freq-row{display:flex;align-items:center;gap:10px}\
.airoha-npu-freq-track{flex:1;width:100%;max-width:350px;height:12px}\
.airoha-npu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:10px;align-items:start}\
.airoha-npu-band-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}\
.airoha-npu-pse-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px}\
.airoha-npu-pse-cell{background:var(--background-color-high,#fff);border:1px solid var(--border-color-medium,#d0d0d0);border-radius:5px;padding:6px 8px;font-size:12px}\
.airoha-npu-pse-cell-drop{border-color:var(--error-color-medium,#f44336)}\
';

/* ── Helpers ── */
var bandNames = ['2.4 GHz', '5 GHz', '6 GHz'];

var psePortMap = [
	'CDM1', 'GDM1', 'GDM2', 'GDM3', 'PPE1', 'CDM2', 'CDM3', 'CDM4', 'PPE2', 'GDM4'
];

function fmtFreq(khz) { return (!khz || khz === 0) ? _('N/A') : (khz / 1000).toFixed(0) + ' MHz'; }
function fmtK(n) {
	if (!n || n === 0) return '0';
	if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
	if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
	return n.toString();
}

function calcTotalMem(regions) {
	var t = 0;
	(regions || []).forEach(function(r) {
		var m = (r.size || '').match(/(\d+)\s*(KiB|MiB|GiB)/i);
		if (m) { var s = parseInt(m[1]); var u = m[2][0].toUpperCase(); t += u === 'G' ? s*1048576 : u === 'M' ? s*1024 : s; }
	});
	return t >= 1024 ? (t/1024).toFixed(0)+' MiB' : t+' KiB';
}

// Occupancy shown as a load: quiet is good, full is not. Returned as a class
// from the export tier so the shade follows the theme.
function loadClass(pct) {
	return pct > 80 ? 'error' : pct > 50 ? 'warn' : 'ok';
}

function getBandStats(ti, b) {
	var c = Array.isArray(ti.station_counts) ? ti.station_counts : [];
	for (var i=0;i<c.length;i++) if (c[i].band===b) return c[i];
	return { band:b, count:0, tx_packets:0, tx_retries:0 };
}

function getTxQueue(ti, b) {
	var q = Array.isArray(ti.tx_queues) ? ti.tx_queues : [];
	for (var i=0;i<q.length;i++) if (q[i].band===b) return q[i];
	return null;
}

function bandHealth(s) {
	if (!s || s.count===0) return { text:_('No clients'), cls:'idle' };
	if (!s.tx_packets) return { text:_('Idle'), cls:'idle' };
	var r = s.tx_retries/(s.tx_packets+s.tx_retries);
	return r>0.5 ? {text:_('Poor'),cls:'error'} : r>0.2 ? {text:_('Fair'),cls:'warn'} : {text:_('Good'),cls:'ok'};
}

function retryPct(s) {
	if (!s || !s.tx_packets) return '-';
	return (s.tx_retries/(s.tx_packets+s.tx_retries)*100).toFixed(1)+'%';
}

/* ── Mini Band Chip (compact for FE diagram) ── */
function renderBandChip(band, txQ, stats) {
	var name = bandNames[band] || _('Band %d').format(band);
	var h = bandHealth(stats);
	var type = txQ ? txQ.type : '?';

	return E('div', { 'class': 'airoha-npu-pse-cell' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px' }, [
			E('span', { 'class': 'airoha-npu-title', 'style': 'font-size:13px' }, name),
			E('span', { 'class': 'airoha-npu-chip '+(type==='npu'?'airoha-npu-chip-npu':'airoha-npu-chip-off'), 'style': 'font-size:9px' }, type.toUpperCase())
		]),
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:6px' }, [
			E('span', { 'class': 'airoha-npu-'+h.cls, 'style': 'display:flex;align-items:center;gap:4px;font-weight:500' }, [
				E('span', { 'class': 'airoha-npu-dot' }),
				E('span', {}, h.text)
			]),
			E('span', { 'class': 'airoha-npu-muted' }, _('%d sta').format(stats.count)),
			(stats.tx_packets > 0) ? E('span', { 'class': 'airoha-npu-muted' }, retryPct(stats)) : E('span')
		])
	]);
}

/* ── Frame Engine Diagram (with WiFi bands, NPU, PPE flows) ── */
function renderFeDiagram(fe, ti, st) {
	if (!fe || fe.error) return E('div', { 'class': 'airoha-npu-muted' }, _('devmem is not available on this build'));
	ti = ti || {}; st = st || {};

	var ports = Array.isArray(fe.pse_ports) ? fe.pse_ports : [];

	// Helper: GDM card
	function gdmCard(key, name, label, pse) {
		var d = fe[key] || {};
		var active = d.tx > 0 || d.rx > 0;
		return E('div', { 'class': 'airoha-npu-card' + (active ? ' airoha-npu-card-active' : '') }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px' }, [
				E('span', { 'class': 'airoha-npu-title' }, name),
				E('span', { 'class': 'airoha-npu-label' }, pse)
			]),
			E('div', { 'class': 'airoha-npu-label', 'style': 'margin-bottom:6px' }, label),
			E('div', { 'style': 'display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px' }, [
				E('span', { 'class': 'airoha-npu-muted' }, _('TX')), E('span', { 'class': 'airoha-npu-text', 'style': 'text-align:right' }, fmtK(d.tx)),
				E('span', { 'class': 'airoha-npu-muted' }, _('RX')), E('span', { 'class': 'airoha-npu-text', 'style': 'text-align:right' }, fmtK(d.rx))
			].concat(d.tx_drop > 0 ? [
				E('span', { 'class': 'airoha-npu-error' }, _('TX Drop')), E('span', { 'class': 'airoha-npu-error', 'style': 'text-align:right' }, fmtK(d.tx_drop))
			] : []).concat(d.rx_drop > 0 ? [
				E('span', { 'class': 'airoha-npu-error' }, _('RX Drop')), E('span', { 'class': 'airoha-npu-error', 'style': 'text-align:right' }, fmtK(d.rx_drop))
			] : []))
		]);
	}

	// Helper: CDM offload bar
	function cdmCard(key, name, label, pse) {
		var d = fe[key] || {};
		var total = (d.rx_cpu||0) + (d.rx_hwf||0);
		var pct = total > 0 ? ((d.rx_hwf/total)*100).toFixed(1) : '0.0';
		// Here a high share is the good case: it is traffic the CPU never saw.
		var barCls = total === 0 ? 'idle' : parseFloat(pct) > 80 ? 'ok' : parseFloat(pct) > 50 ? 'warn' : 'error';
		return E('div', { 'class': 'airoha-npu-card' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;gap:8px;margin-bottom:4px' }, [
				E('span', { 'class': 'airoha-npu-title', 'style': 'font-size:13px' }, name+' '+pse),
				E('span', { 'class': 'airoha-npu-label' }, label)
			]),
			E('div', { 'class': 'airoha-npu-text', 'style': 'font-size:12px;margin-bottom:4px' }, _('HW Offload: %s%%').format(pct)),
			E('div', { 'class': 'airoha-npu-bar-track', 'style': 'height:6px' }, [
				E('div', { 'class': 'airoha-npu-bar-fill airoha-npu-bar-'+barCls, 'style': 'width:'+pct+'%' })
			]),
			E('div', { 'style': 'display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-top:4px' }, [
				E('span', { 'class': 'airoha-npu-muted' }, _('CPU: %s').format(fmtK(d.rx_cpu||0))),
				E('span', { 'class': 'airoha-npu-muted' }, _('HWF: %s').format(fmtK(d.rx_hwf||0))),
				E('span', { 'class': 'airoha-npu-muted' }, _('TX: %s').format(fmtK(d.tx||0)))
			])
		]);
	}

	// WiFi band chips for CDM4
	var bandChips = [];
	for (var b = 0; b < 3; b++) bandChips.push(renderBandChip(b, getTxQueue(ti, b), getBandStats(ti, b)));

	// CDM4/WDMA + WiFi bands grouped
	var p7 = ports[7] || { iq: 0, oq: 0, drops: 0 };
	var cdm4WiFi = E('div', { 'class': 'airoha-npu-card' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px' }, [
			E('span', { 'class': 'airoha-npu-title' }, 'CDM4 / WDMA'),
			E('span', { 'class': 'airoha-npu-label' }, _('P7 WiFi DMA'))
		]),
		E('div', { 'style': 'display:flex;gap:12px;font-size:11px;margin-bottom:8px' }, [
			E('span', { 'class': 'airoha-npu-muted' }, 'IQ '+p7.iq),
			E('span', { 'class': 'airoha-npu-muted' }, 'OQ '+p7.oq),
			p7.drops > 0 ? E('span', { 'class': 'airoha-npu-error' }, _('Drop %s').format(fmtK(p7.drops))) : null
		].filter(Boolean)),
		// WiFi bands inside
		E('div', { 'class': 'airoha-npu-band-grid' }, bandChips)
	]);

	// NPU indicator
	var npuActive = st.npu_loaded;
	var npuCard = E('div', { 'class': 'airoha-npu-card' + (npuActive ? ' airoha-npu-card-active' : '') }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' }, [
			E('span', { 'class': 'airoha-npu-title' }, 'NPU'),
			E('span', { 'class': 'airoha-npu-chip '+(npuActive?'airoha-npu-chip-on':'airoha-npu-chip-off') }, npuActive ? _('Active') : _('Off'))
		]),
		E('div', { 'class': 'airoha-npu-label', 'style': 'margin-bottom:4px' }, _('8x RISC-V via PCIe RAM')),
		E('div', { 'style': 'font-size:11px' }, [
			E('span', { 'class': 'airoha-npu-muted' }, _('Manages: ')),
			E('span', { 'class': 'airoha-npu-text' }, _('PPE init, WDMA rings, flow stats'))
		])
	]);

	// PPE engines with flow count
	var ppeCard = E('div', { 'class': 'airoha-npu-card airoha-npu-card-active' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' }, [
			E('span', { 'class': 'airoha-npu-title' }, _('PPE Engines')),
			E('span', { 'class': 'airoha-npu-label' }, 'P4 + P8')
		]),
		E('div', { 'style': 'display:flex;gap:16px;font-size:12px' }, [
			E('span', {}, [
				E('span', { 'class': 'airoha-npu-muted' }, _('Bound ')),
				E('span', { 'class': 'airoha-npu-text', 'style': 'font-weight:bold' }, (st.offload_bound||0).toString())
			]),
			E('span', {}, [
				E('span', { 'class': 'airoha-npu-muted' }, _('Total ')),
				E('span', { 'class': 'airoha-npu-text' }, (st.offload_total||0).toString())
			])
		])
	]);

	// PSE buffer
	var pseT = (fe.pse_used||0)+(fe.pse_free||0);
	var pseP = pseT>0 ? ((fe.pse_used/pseT)*100).toFixed(1) : '0';

	// PSE port cells (skip P7 since it's shown in CDM4/WiFi section)
	var portCells = ports.filter(function(p){ return p.port !== 7; }).map(function(p) {
		var name = psePortMap[p.port] || '';
		var drop = p.drops > 0;
		return E('div', { 'class': 'airoha-npu-pse-cell' + (drop ? ' airoha-npu-pse-cell-drop' : '') }, [
			E('div', { 'class': 'airoha-npu-text', 'style': 'font-weight:600;font-size:11px' }, ('P'+p.port+' '+name).trim()),
			E('div', { 'style': 'display:flex;gap:8px;font-size:11px;margin-top:2px' }, [
				E('span', { 'class': 'airoha-npu-muted' }, 'IQ '+p.iq),
				E('span', { 'class': 'airoha-npu-muted' }, 'OQ '+p.oq),
				drop ? E('span', { 'class': 'airoha-npu-error' }, fmtK(p.drops)) : null
			].filter(Boolean))
		]);
	});

	return E('div', {}, [
		// PSE buffer bar
		E('div', { 'class': 'airoha-npu-card', 'style': 'margin-bottom:10px' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;gap:8px;margin-bottom:4px' }, [
				E('span', { 'class': 'airoha-npu-title', 'style': 'font-size:13px' }, _('PSE Shared Buffer')),
				E('span', { 'class': 'airoha-npu-muted', 'style': 'font-size:12px' }, _('%d used / %d free (%s%%)').format(fe.pse_used||0, fe.pse_free||0, pseP))
			]),
			E('div', { 'class': 'airoha-npu-bar-track', 'style': 'height:8px' }, [
				E('div', { 'class': 'airoha-npu-bar-fill airoha-npu-bar-'+loadClass(parseFloat(pseP)), 'style': 'width:'+pseP+'%' })
			])
		]),
		// Row 1: GDM ports
		E('div', { 'class': 'airoha-npu-grid' }, [
			gdmCard('gdm1', 'GDM1', _('Internal Switch (1G LAN3/4)'), 'P1'),
			gdmCard('gdm2', 'GDM2', _('WAN (USXGMII 10G)'), 'P2'),
			gdmCard('gdm4', 'GDM4', _('LAN2 (USXGMII 10G)'), 'P9')
		]),
		// Row 2: CDM1/CDM2 (CPU) + CDM4/WiFi
		E('div', { 'class': 'airoha-npu-grid' }, [
			cdmCard('cdm1', 'CDM1', _('CPU DMA 1'), 'P0'),
			cdmCard('cdm2', 'CDM2', _('CPU DMA 2'), 'P5'),
			cdm4WiFi
		]),
		// Row 3: PPE + NPU
		E('div', { 'class': 'airoha-npu-grid' }, [
			ppeCard,
			npuCard
		]),
		// PSE port grid
		E('div', { 'class': 'airoha-npu-text', 'style': 'font-size:12px;font-weight:600;margin-bottom:6px' }, _('PSE Port Queue Status')),
		E('div', { 'class': 'airoha-npu-pse-grid' }, portCells)
	]);
}

/* ── CPU Frequency ── */
// The PLL sitting above what cpufreq is allowed to ask for is an overclock
// whichever governor is running: the direct write goes behind cpufreq's back,
// so the governor says nothing about whether it happened.
function freqBarState(hw, min, max, pll) {
	var oc = pll>0 && (pll*1000)>max;
	return { freq: oc ? pll*1000 : Math.min(hw,max), max: oc ? pll*1000 : max, oc: oc };
}

function freqBarPct(s, min) {
	if (!(s.max > min)) return 0;
	return Math.max(0, Math.min(100, Math.round(((s.freq-min)/(s.max-min))*100)));
}

function freqBarLabel(s, pll) {
	return s.oc ? (pll+' MHz (OC)') : fmtFreq(s.freq);
}

function renderFreqBar(hw, min, max, pll) {
	if (!max) return E('span',{},_('N/A'));
	var s = freqBarState(hw,min,max,pll);

	// The reading sits above the bar rather than on top of it: a label
	// overlaying the track covers both the filled and the empty part, and no
	// single ink colour is guaranteed to be readable on both.
	return E('div', {}, [
		E('div', { 'id':'airoha-npu-freq-value', 'class':'airoha-npu-freq-value' }, freqBarLabel(s, pll)),
		E('div', { 'class':'airoha-npu-freq-row' }, [
			E('span', { 'class':'airoha-npu-muted', 'style':'font-size:90%' }, fmtFreq(min)),
			E('div', { 'class':'airoha-npu-bar-track airoha-npu-freq-track' }, [
				E('div', { 'id':'airoha-npu-freq-fill', 'class':'airoha-npu-bar-fill airoha-npu-bar-'+(s.oc?'warn':'ok'), 'style':'width:'+freqBarPct(s,min)+'%' })
			]),
			E('span', { 'id':'airoha-npu-freq-max', 'class':'airoha-npu-muted', 'style':'font-size:90%' }, fmtFreq(s.max))
		])
	]);
}

function updateFreqBar(hw, min, max, pll) {
	var s = freqBarState(hw,min,max,pll);
	var el = document.getElementById('airoha-npu-freq-value');
	var fl = document.getElementById('airoha-npu-freq-fill');
	var ml = document.getElementById('airoha-npu-freq-max');
	if (el) el.textContent = freqBarLabel(s, pll);
	if (fl && s.max>0) {
		fl.style.width = freqBarPct(s,min)+'%';
		fl.className = 'airoha-npu-bar-fill airoha-npu-bar-'+(s.oc?'warn':'ok');
	}
	if (ml) ml.textContent = fmtFreq(s.max);
}

function renderGovSelect(avail, active) {
	var gs = (avail||'').trim().split(/\s+/).filter(Boolean);
	if (!gs.length) return E('span',{},_('N/A'));
	return E('select', { 'id':'airoha-npu-governor-select','class':'cbi-input-select','style':'min-width:140px','change':function(ev){
		var sel=ev.target; sel.disabled=true;
		callSetGovernor(sel.value).then(function(r){
			if(r&&r.error) ui.addNotification(null,E('p',{},_('Error: %s').format(r.error)),'error');
		}).catch(function(e){
			ui.addNotification(null,E('p',{},_('Could not set the governor: %s').format(e.message)),'error');
		}).then(function(){ sel.disabled=false; });
	}}, gs.map(function(g){return E('option',{'value':g,'selected':g===active?'':null},g);}));
}

function renderMaxFreqSelect(avail, cur) {
	var fs = (avail||'').trim().split(/\s+/).filter(Boolean);
	if (!fs.length) return E('span',{},_('N/A'));
	// scaling_max_freq is not always one of scaling_available_frequencies -
	// firmware that offers a step above the OPP table puts a value here that
	// the list does not contain, and a select with no matching option renders
	// blank. Carry the current value into the list so it can be displayed.
	if (cur && fs.indexOf(String(parseInt(cur))) < 0) {
		fs.push(String(parseInt(cur)));
		fs.sort(function(a,b){ return parseInt(a)-parseInt(b); });
	}
	return E('select', { 'id':'airoha-npu-maxfreq-select','class':'cbi-input-select','style':'min-width:140px','change':function(ev){
		var sel=ev.target; sel.disabled=true;
		callSetMaxFreq(parseInt(sel.value)).then(function(r){
			if(r&&r.error) ui.addNotification(null,E('p',{},_('Error: %s').format(r.error)),'error');
		}).catch(function(e){
			ui.addNotification(null,E('p',{},_('Could not set the maximum frequency: %s').format(e.message)),'error');
		}).then(function(){ sel.disabled=false; });
	}}, fs.map(function(f){return E('option',{'value':f,'selected':parseInt(f)===parseInt(cur)?'':null},(parseInt(f)/1000).toFixed(0)+' MHz');}));
}

function socLabel(soc) {
	if (soc === 'an7583') return 'AN7583';
	if (soc === 'en7581') return 'AN7581';
	return _('Unknown');
}

// The highest frequency this package has been run at on real hardware. The
// ceiling itself is the backend's (AIROHA_OC_MAX_MHZ), which a characterisation
// sweep may raise well past what anyone has tested.
var OC_TESTED_MHZ = 1400;

// Ask before going past the frequency the package has been tested at. A
// blocking confirm() freezes the whole page and is styled by the browser,
// so use the LuCI modal and continue on its answer.
function confirmHighFreq(mhz) {
	return new Promise(function(resolve) {
		ui.showModal(_('Confirm overclock'), [
			E('p', {}, _('%d MHz is above %d MHz, which is as far as this has been tested. The board may run unstable or stop responding until it is power cycled.').format(mhz, OC_TESTED_MHZ)),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); resolve(false); } }, _('Cancel')),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() { ui.hideModal(); resolve(true); } }, _('Continue'))
			])
		]);
	});
}

function applyOverclock(btn, mhz) {
	btn.disabled = true;
	btn.textContent = _('Applying...');
	return callSetOverclock(mhz).then(function(r) {
		if (r && r.error)
			ui.addNotification(null, E('p', {}, _('Failed: %s').format(r.error)), 'error');
		else if (r && r.result === 'ok')
			ui.addNotification(null, E('p', {}, _('CPU set to %d MHz').format(r.actual_mhz)), 'info');
	}).catch(function(e) {
		ui.addNotification(null, E('p', {}, _('Overclock request failed: %s').format(e.message)), 'error');
	}).then(function() {
		btn.disabled = false;
		btn.textContent = _('Apply');
	});
}

function renderOcControls(soc, ocMin, ocMax) {
	// The PLL register map differs per SoC, so refuse to write anything when
	// the SoC was not identified rather than poking AN7581 addresses blindly.
	if (soc !== 'an7583' && soc !== 'en7581')
		return E('span',{'class':'airoha-npu-muted'},_('Not available: unrecognised SoC'));

	// The bounds are the backend's, not a second copy of them: it is the side
	// that enforces them, and its ceiling is configurable.
	ocMin = parseInt(ocMin) || 500;
	ocMax = parseInt(ocMax) || 1600;

	var inp = E('input',{'id':'airoha-npu-oc-input','type':'number','min':String(ocMin),'max':String(ocMax),'step':'50','value':String(Math.min(OC_TESTED_MHZ, ocMax)),'class':'cbi-input-text','style':'width:100px'});
	var btn = E('button',{'class':'cbi-button cbi-button-action','style':'margin-left:8px','click':function(){
		var f=parseInt(inp.value);
		if(isNaN(f)||f<ocMin||f>ocMax){ui.addNotification(null,E('p',{},_('The frequency must be between %d and %d MHz').format(ocMin,ocMax)),'error');return;}
		if(f>OC_TESTED_MHZ)
			confirmHighFreq(f).then(function(ok){ if(ok) applyOverclock(btn,f); });
		else
			applyOverclock(btn,f);
	}},_('Apply'));
	return E('div',{'style':'display:flex;align-items:center;gap:8px;flex-wrap:wrap'},[
		inp, E('span',{'class':'airoha-npu-muted'},'MHz'), btn,
		E('span',{'class':'airoha-npu-muted','style':'font-size:85%;margin-left:8px'},_('Direct PLL write, %d-%d MHz. Tested up to %d MHz.').format(ocMin,ocMax,OC_TESTED_MHZ))
	]);
}

/* ── PPE Table ── */
function renderPpeRows(entries) {
	return entries.slice(0,100).map(function(e) {
		var eth = e.eth||''; if(eth==='00:00:00:00:00:00->00:00:00:00:00:00') eth='-';
		return E('tr',{'class':'tr'},[
			E('td',{'class':'td'},e.index), E('td',{'class':'td'},E('span',{'class':e.state==='BND'?'label-success':''},e.state)),
			E('td',{'class':'td'},e.type), E('td',{'class':'td'},e.orig||'-'), E('td',{'class':'td'},e.new_flow||'-'), E('td',{'class':'td'},eth)
		]);
	});
}

/* ── Main View ── */
// Only getStatus is mandatory. The PPE table needs debugfs, the WiFi token
// info needs mt76 debugfs and the Frame Engine view needs devmem, and the
// README lists all three as optional: a build without them has to show the
// rest of the page, not a stack trace.
function collect() {
	return Promise.all([
		L.resolveDefault(callNpuStatus(), {}),
		L.resolveDefault(callPpeEntries(), {}),
		L.resolveDefault(callTokenInfo(), {}),
		L.resolveDefault(callFrameEngine(), {})
	]);
}

return view.extend({
	load: function() {
		return collect();
	},

	render: function(data) {
		var st = data[0]||{}, ppe = data[1]||{}, ti = data[2]||{}, fe = data[3]||{};
		var entries = Array.isArray(ppe.entries) ? ppe.entries : [];
		var memR = Array.isArray(st.memory_regions) ? st.memory_regions : [];

		var view = E('div',{'class':'cbi-map'},[
			// The stylesheet is part of the view, so it is torn down with the
			// view instead of outliving it in <head> on an SPA theme.
			E('style',{'type':'text/css'}, viewCSS),
			E('h2',{},_('Airoha SoC Status')),

			// CPU Frequency
			E('div',{'class':'cbi-section'},[
				E('h3',{},_('CPU Frequency')),
				E('table',{'class':'table'},[
					E('tr',{'class':'tr'},[ E('td',{'class':'td','width':'33%'},E('strong',{},_('Current Frequency'))), E('td',{'class':'td'}, renderFreqBar(st.cpu_hw_freq,st.cpu_min_freq,st.cpu_max_freq,st.pll_freq_mhz)) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('Governor'))), E('td',{'class':'td'}, renderGovSelect(st.cpu_avail_governors,st.cpu_governor)) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('Max Frequency'))), E('td',{'class':'td'}, renderMaxFreqSelect(st.cpu_avail_freqs,st.cpu_max_freq)) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('Overclock'))), E('td',{'class':'td'}, renderOcControls(st.soc, st.oc_min_mhz, st.oc_max_mhz)) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('CPU Cores'))), E('td',{'class':'td'},(st.cpu_count||0).toString()) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('SoC'))), E('td',{'class':'td'},socLabel(st.soc)) ])
				])
			]),

			// NPU & Frame Engine (unified)
			E('div',{'class':'cbi-section'},[
				E('h3',{},_('NPU & Offload Engine')),
				E('table',{'class':'table'},[
					E('tr',{'class':'tr'},[ E('td',{'class':'td','width':'33%'},E('strong',{},_('NPU Status'))),
						E('td',{'class':'td','id':'airoha-npu-status'}, st.npu_loaded ?
							E('span',{'class':'label-success'},st.npu_device?_('Active (%s)').format(st.npu_device):_('Active')) :
							E('span',{'class':'label-danger'},_('Not Active'))) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('Firmware / Clock / Cores'))),
						E('td',{'class':'td'}, _('%s | %s | %d cores').format(st.npu_version||_('N/A'), st.npu_clock?(st.npu_clock/1e6).toFixed(0)+' MHz':_('N/A'), st.npu_cores||0)) ]),
					E('tr',{'class':'tr'},[ E('td',{'class':'td'},E('strong',{},_('Reserved Memory'))),
						E('td',{'class':'td'}, _('%s (%d regions)').format(calcTotalMem(memR), memR.length)) ])
				]),

				// Frame Engine diagram (includes WiFi bands, PPE flows, NPU indicator)
				E('div',{'style':'margin-top:12px'},[ E('h4',{'class':'airoha-npu-text','style':'font-size:14px;margin-bottom:8px'},_('Frame Engine'))]),
				E('div',{'id':'airoha-npu-fe-container'}, renderFeDiagram(fe, ti, st))
			]),

			// PPE Flow Table
			E('div',{'class':'cbi-section'},[
				E('h3',{},_('PPE Flow Offload Entries')),
				E('table',{'class':'table','id':'airoha-npu-ppe-table'},[
					E('tr',{'class':'tr cbi-section-table-titles'},[
						E('th',{'class':'th'},_('Index')), E('th',{'class':'th'},_('State')), E('th',{'class':'th'},_('Type')),
						E('th',{'class':'th'},_('Original Flow')), E('th',{'class':'th'},_('New Flow')), E('th',{'class':'th'},_('Ethernet'))
					])
				].concat(renderPpeRows(entries)))
			])
		]);

		poll.add(L.bind(function() {
			return collect().then(L.bind(function(d) {
				var st=d[0]||{}, ppe=d[1]||{}, ti=d[2]||{}, fe=d[3]||{};
				var entries = Array.isArray(ppe.entries)?ppe.entries:[];

				updateFreqBar(st.cpu_hw_freq,st.cpu_min_freq,st.cpu_max_freq,st.pll_freq_mhz);
				var gs=document.getElementById('airoha-npu-governor-select'); if(gs&&!gs.matches(':focus')) gs.value=st.cpu_governor||'';
				var fs=document.getElementById('airoha-npu-maxfreq-select'); if(fs&&!fs.matches(':focus')) fs.value=(st.cpu_max_freq||0).toString();

				var se=document.getElementById('airoha-npu-status');
				if(se){se.innerHTML='';var sp=document.createElement('span');sp.className=st.npu_loaded?'label-success':'label-danger';sp.textContent=st.npu_loaded?(st.npu_device?_('Active (%s)').format(st.npu_device):_('Active')):_('Not Active');se.appendChild(sp);}

				var fc=document.getElementById('airoha-npu-fe-container'); if(fc){fc.innerHTML='';fc.appendChild(renderFeDiagram(fe, ti, st));}

				var tb=document.getElementById('airoha-npu-ppe-table');
				if(tb){while(tb.rows.length>1)tb.deleteRow(1);renderPpeRows(entries).forEach(function(r){tb.appendChild(r);});}
			},this));
		},this), 5);

		return view;
	},

	handleSaveApply: null, handleSave: null, handleReset: null
});
