// Land borders between countries, for the Border Hop tab and the Mystery Country clues.
// Codes are FLAG_DATA country codes ('world:<code>'), plus Western Sahara (eh), which sits
// on the only land route between Morocco and the rest of Africa.
// Left out on purpose: sea-only links, Spain–Morocco (Ceuta/Melilla), Spain–UK (Gibraltar),
// France–Brazil/Suriname (French Guiana) and the UK bases on Cyprus, so the continents stay apart
// the way most people picture them. Lakes count as borders (Tanzania–DR Congo via Lake Tanganyika).
// Checked November 2026.
const FM_BORDERS = (() => {
  const raw = `
    dz: ma eh mr ml ne ly tn
    ma: eh
    eh: mr
    mr: ml sn
    ml: sn gn ci bf ne
    sn: gm gn gw
    gw: gn
    gn: sl lr ci
    sl: lr
    lr: ci
    ci: gh bf
    gh: bf tg
    tg: bf bj
    bj: bf ne ng
    bf: ne
    ne: ng td ly
    ng: td cm
    td: ly sd cf cm
    cm: cf cg ga gq
    gq: ga
    ga: cg
    cg: cf cd ao
    cf: sd ss cd
    cd: ss ug rw bi tz zm ao
    ly: eg sd tn
    eg: sd il ps
    sd: ss er et
    ss: et ke ug
    er: et dj
    dj: et so
    et: so ke
    so: ke
    ke: ug tz
    ug: rw tz
    rw: bi tz
    bi: tz
    tz: zm mw mz
    zm: mw mz zw bw na ao
    ao: na
    na: bw za
    bw: zw za
    zw: mz za
    mz: mw za sz
    za: sz ls

    il: ps jo sy lb
    ps: jo
    lb: sy
    sy: jo iq tr
    jo: iq sa
    iq: sa kw ir tr
    kw: sa
    sa: qa ae om ye
    ae: om
    om: ye
    tr: gr bg ge am az ir
    ir: am az tm af pk
    ge: ru am az
    am: az
    az: ru
    tm: kz uz af
    uz: kz kg tj af
    kg: kz tj cn
    tj: af cn
    kz: ru cn
    af: pk cn
    pk: in cn
    in: cn np bt bd mm
    np: cn
    bt: cn
    bd: mm
    mm: cn la th
    cn: mn ru kp vn la
    mn: ru
    kp: kr ru
    vn: la kh
    la: th kh
    th: kh my
    my: bn id
    id: tl pg

    ru: no fi ee lv by ua lt pl
    no: se fi
    se: fi
    ee: lv
    lv: lt by
    lt: by pl
    pl: de cz sk ua by
    by: ua
    ua: md ro hu sk
    md: ro
    ro: hu rs bg
    bg: rs mk gr
    gr: mk al
    al: me xk mk
    mk: rs xk
    xk: rs me
    me: rs ba hr
    rs: ba hr hu
    ba: hr
    hr: si hu
    si: it at hu
    hu: sk at
    sk: cz at
    cz: de at
    at: de ch li it
    ch: de fr it li
    it: fr sm va
    fr: es ad mc be lu de
    es: pt ad
    de: dk nl be lu
    be: nl lu
    gb: ie

    us: ca mx
    mx: gt bz
    gt: bz sv hn
    sv: hn
    hn: ni
    ni: cr
    cr: pa
    pa: co
    co: ve br pe ec
    ve: gy br
    gy: sr br
    sr: br
    br: uy ar py bo pe
    ec: pe
    pe: bo cl
    bo: cl ar py
    py: ar
    ar: cl uy
    do: ht
  `;
  const adj = {};
  const link = (a, b) => { (adj[a] || (adj[a] = new Set())).add(b); (adj[b] || (adj[b] = new Set())).add(a); };
  raw.trim().split('\n').forEach(line => {
    const m = line.trim().match(/^([a-z]{2}):\s*(.*)$/); if (!m) return;
    m[2].split(/\s+/).filter(Boolean).forEach(b => link(m[1], b));
  });
  const id = c => (c === 'eh' ? 'terr:' : 'world:') + c;
  const out = {};
  Object.entries(adj).forEach(([a, set]) => { out[id(a)] = [...set].map(id); });
  return out;
})();
