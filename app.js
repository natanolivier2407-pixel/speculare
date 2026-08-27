// ============================================================
//  HYPOTHÈSES (valeurs de base de la PME)
//  kind: money | pct | days | num | years   (pct affiché en %, /100 dans le moteur)
// ============================================================
const GROUPS = [
  {titre:"Paramètres clés", open:false, items:[
    {key:"nbAnnees", lab:"Nombre d'années de prévision", v:5, min:3, max:10, step:1, kind:"years",
      tip:"Durée de l'horizon de prévision (de 3 à 10 ans). Toutes les tables, graphes et la valo DCF s'adaptent automatiquement."},
    {key:"capex", lab:"CAPEX courant / an",        v:110000, min:0, max:1000000, step:10000, kind:"money",
      tip:"Le chiffre d'affaires, les volumes, prix et coûts variables se règlent désormais par référence produit (bouton « Gérer les références »)."},
  ]},
  {titre:"Coûts & marge", open:false, items:[
    {key:"cfN",   lab:"Charges fixes en N",         v:420000, min:0, max:1000000, step:10000, kind:"money"},
    {key:"persoN",lab:"Charges de personnel en N",  v:380000, min:0, max:1000000, step:10000, kind:"money"},
    {key:"tauxIS",lab:"Taux d'imposition (IS)",     v:25,  min:0, max:40, step:1, kind:"pct"},
  ]},
  {titre:"BFR — délais", open:false, items:[
    {key:"DSO",lab:"DSO — délai clients",      v:45, min:0, max:180, step:5, kind:"days",
      tip:"Days Sales Outstanding : délai moyen de paiement des clients, en jours. Plus il est élevé, plus le cash est immobilisé dans les créances."},
    {key:"DPO",lab:"DPO — délai fournisseurs", v:60, min:0, max:180, step:5, kind:"days",
      tip:"Days Payable Outstanding : délai moyen de paiement des fournisseurs. Plus il est élevé, mieux c'est pour la trésorerie (on garde le cash plus longtemps)."},
    {key:"DIO",lab:"DIO — durée de stockage",  v:30, min:0, max:180, step:5, kind:"days",
      tip:"Days Inventory Outstanding : durée moyenne de stockage, en jours. Plus il est élevé, plus le stock gèle du cash."},
  ]},
  {titre:"Immobilisations", open:false, items:[
    {key:"immoOuv0",lab:"Immos nettes ouverture N", v:800000, min:0, max:3000000, step:50000, kind:"money"},
    {key:"duree",   lab:"Durée d'amortissement",     v:8, min:1, max:25, step:1, kind:"years"},
  ]},
  {titre:"Coût du capital (WACC)", view:'both', open:false, items:[
    {key:"wacc",     lab:"Coût du capital (WACC)", v:8, min:0, max:25, step:0.5, kind:"pct",
      tip:"Coût Moyen Pondéré du Capital : rendement minimum attendu par les financeurs (dette + fonds propres). Sert de seuil au conseiller (ROCE > WACC = création de valeur) ET de taux d'actualisation du DCF."},
  ]},
  {titre:"Financement", open:false, items:[
    {key:"tauxDiv",  lab:"Taux de dividende",     v:30, min:0, max:100, step:5, kind:"pct"},
    {key:"rnN1",     lab:"Résultat net N-1",      v:70000, min:-200000, max:500000, step:10000, kind:"money"},
  ]},
  {titre:"Valorisation DCF", view:'dcf', open:false, items:[
    {key:"dcfG",   lab:"Croissance perpétuelle (g)", v:2, min:-2, max:6, step:0.25, kind:"pct",
      tip:"Taux de croissance à l'infini des flux après l'horizon (valeur terminale de Gordon). Doit rester < WACC et proche de la croissance long terme de l'économie."},
    {key:"dcfExit",lab:"Multiple de sortie (EV/EBITDA ×)", v:6, min:1, max:20, step:0.5, kind:"num",
      tip:"Méthode alternative de valeur terminale : on revend l'entreprise en fin d'horizon à ce multiple d'EBITDA. Sert de contre-vérification à la méthode de Gordon."},
  ]},
  {titre:"Bilan d'ouverture", open:false, items:[
    {key:"openStocks",  lab:"Stocks ouverture",          v:110000, min:0, max:500000, step:5000, kind:"money"},
    {key:"openCreances",lab:"Créances clients ouverture",v:290000, min:0, max:500000, step:5000, kind:"money"},
    {key:"tresoOuv0",   lab:"Trésorerie ouverture (calculée)", v:50000, kind:"money", derived:true,
      tip:"Calculée pour équilibrer le bilan d'ouverture : capitaux propres + dettes (dont dette d'ouverture) − immos − BFR d'ouverture. Conséquence : + de dette à l'ouverture = + de trésorerie."},
    {key:"openDettesF", lab:"Dettes fournisseurs ouv.",  v:220000, min:0, max:500000, step:5000, kind:"money"},
    {key:"cpOuv0",      lab:"Capitaux propres ouverture",v:650000, min:0, max:3000000, step:5000, kind:"money"},
  ]},
];
function mkYears(n){ return Array.from({length:n},(_,i)=> i===0?'N':'N+'+i); }
let ANNEES = mkYears(5);      // horizon paramétrable (3..10 ans) — reconstruit par applyHorizon()
let NY = ANNEES.length;
// ---- Portefeuille d'emprunts par défaut : la dette d'ouverture, modélisée en annuités constantes ----
// depart : 'ouv' = dette déjà en cours à l'ouverture (pas d'encaissement) ; 0..NY-1 = emprunt tiré cette année-là.
// L'entreprise emprunte sur une DURÉE fixée → la mensualité (annuité) est calculée en PMT. (Le mode « par mensualité » a été retiré : sans intérêt pour une entreprise.)
const LOANS_DEF = [
  {nom:"Dette initiale", montant:500000, taux:4, duree:8, depart:'ouv'},
];

// ---- Mode d'équilibrage du bilan d'ouverture ----
// 'treso'   : la trésorerie d'ouverture est le plug (défaut historique — « voici ta trésorerie »).
// 'funding' : on FIXE une trésorerie cible et on DÉDUIT le financement à lever (« voici ce que tu dois lever »),
//             réparti entre un emprunt d'amorçage (qui s'amortit) et un apport en capital (fonds propres).
let openMode='treso';
const FUND_DEF={ targetCash:50000, partDette:70, tauxAmor:5.5, dureeAmor:7 };
let fund={...FUND_DEF};

// ============================================================
//  RÉFÉRENCES PRODUITS — le CA et les charges variables sont la SOMME des références.
//  Chaque référence : volume, prix unitaire, coût variable unitaire (marge = prix − coût),
//  chacun soit en trajectoire auto (valeur en N + croissance/an), soit saisi par année (…Ov).
//  1 référence = comportement mono-produit historique. La ref par défaut reproduit la base (10 000 × 50 €, CV 45 %).
// ============================================================
// Chaque métrique = une valeur en N + une trajectoire optionnelle décrite dans la modale
// « par année » (valeur ou croissance). Plus de taux de croissance en doublon dans la carte.
// Gamme par défaut d'une PME industrielle : un produit de volume, un produit premium
// (marge unitaire forte, volume faible) et une activité de services récurrents à forte marge.
// Les trois ensemble donnent un mix réaliste — et rendent l'effet mix visible dès l'ouverture.
// Croissance de volume différenciée : le premium et les services croissent plus vite que
// la ligne de volume. Ce sont aussi les deux plus fortes marges → le mix s'améliore avec le
// temps, et l'onglet « Par référence » raconte quelque chose dès l'ouverture.
// trajectoire « croissance constante de x % par an », au format de la modale « Évolution »
const croissance = x => ({kind:'rates', mode:'const', r:new Array(10).fill(x)});
const REFS_DEF = [
  {id:'r1', nom:'Ligne standard',       volN:12000, prixN:85,  coutN:52,  volOv:croissance(3), prixOv:null, coutOv:null},
  {id:'r2', nom:'Ligne premium',        volN:3500,  prixN:210, coutN:118, volOv:croissance(8), prixOv:null, coutOv:null},
  {id:'r3', nom:'Pièces & maintenance', volN:9000,  prixN:68,  coutN:34,  volOv:croissance(5), prixOv:null, coutOv:null},
];
let refs = JSON.parse(JSON.stringify(REFS_DEF));   // source de vérité (unités d'affichage)
const REF_METRICS = [
  {m:'vol',  lab:'Volume',                base:'volN',  ov:'volOv',  unit:'',  step:500},
  {m:'prix', lab:'Prix unitaire',         base:'prixN', ov:'prixOv', unit:'€', step:5},
  {m:'cout', lab:'Coût variable unitaire',base:'coutN', ov:'coutOv', unit:'€', step:1},
];
const metricOv = m => ({vol:'volOv', prix:'prixOv', cout:'coutOv'}[m]);
// valeur effective en N : la base pilote toujours, y compris quand une croissance s'y applique
const refN = (r,base,ov) => { const s=ovSeries(r[ov], +r[base]||0); return s? (+s[0]||0) : (+r[base]||0); };
// convertit les références (affichage) en unités moteur : chaque override est développé en série
function engineRefs(dr){
  return (dr||[]).map(r=>({
    nom:r.nom,
    volN:+r.volN||0, prixN:+r.prixN||0, coutN:+r.coutN||0,
    volOv: ovSeries(r.volOv,  +r.volN||0),
    prixOv:ovSeries(r.prixOv, +r.prixN||0),
    coutOv:ovSeries(r.coutOv, +r.coutN||0),
  }));
}
// migration : un état sauvegardé peut avoir .refs (nouveau) ou seulement l'ancien mono-produit (H.volN/prixN/tauxCV)
function migrateRefsFromState(s){
  if(s && Array.isArray(s.refs) && s.refs.length) return JSON.parse(JSON.stringify(s.refs));
  const H=(s&&s.H)||{};
  if(H.volN!=null && H.prixN!=null){
    const prix=+H.prixN||0, tcv=+H.tauxCV||0;
    return [{id:'r1', nom:'Produit principal', volN:+H.volN||0, gVol:+H.gVol||0, prixN:prix, gPrix:+H.gPrix||0,
      coutN:Math.round(prix*tcv/100*100)/100, gCout:+H.gPrix||0, volOv:null, prixOv:null, coutOv:null}];
  }
  return JSON.parse(JSON.stringify(REFS_DEF));
}

// ============================================================
//  MOTEUR D'EMPRUNTS — amortissement à annuités constantes
//  (mensualité fixe : les intérêts baissent, le capital remboursé monte)
// ============================================================
function loanDuree(l){ return Math.max(1, Math.round(l.duree||1)); }   // durée fixée par l'utilisateur (en années)
function loanAnnuite(montant,tauxPct,n){   // annuité constante (PMT annuel)
  const r=(tauxPct||0)/100;
  return r===0 ? montant/n : montant*r/(1-Math.pow(1+r,-n));
}
function loanMensualite(l){ return loanAnnuite(l.montant, l.taux, loanDuree(l))/12; }
function amortSchedule(montant,tauxPct,n){ // tableau année par année
  const r=(tauxPct||0)/100, A=loanAnnuite(montant,tauxPct,n), rows=[];
  let solde=montant;
  for(let k=0;k<n;k++){
    const interet=solde*r;
    let capital=A-interet;
    if(k===n-1) capital=solde;             // dernière échéance : solde ramené exactement à 0
    const soldeOuv=solde; solde=Math.max(0, solde-capital);
    rows.push({soldeOuv, interet, capital, soldeClot:solde, annuite:A});
  }
  return rows;
}
// Agrège un portefeuille d'emprunts en séries annuelles alignées sur la timeline du modèle.
// Identité préservée : detteClot[t] − detteClot[t−1] = nouvelEmp[t] − capital[t]  (bilan équilibré).
function buildLoans(loanDefs){
  const L=(loanDefs||[]).map(ld=>{
    const n=loanDuree(ld), start=ld.depart==='ouv'?0:(parseInt(ld.depart,10)||0);
    return {...ld, n, start, initial:ld.depart==='ouv', rows:amortSchedule(ld.montant, ld.taux, n)};
  });
  const horizon=Math.max(NY, ...L.map(l=>l.start+l.n), 1);
  const A=()=>new Array(horizon).fill(0);
  const interet=A(), capital=A(), nouvelEmp=A(), detteClot=A(), detteOuv=A();
  let initOuv=0;
  L.forEach(l=>{
    if(l.initial) initOuv+=(+l.montant||0);
    else if(l.start<horizon) nouvelEmp[l.start]+=(+l.montant||0);   // encaissement l'année du tirage
    l.rows.forEach((row,k)=>{
      const t=l.start+k; if(t>=horizon) return;
      interet[t]+=row.interet; capital[t]+=row.capital; detteClot[t]+=row.soldeClot;
    });
  });
  for(let t=0;t<horizon;t++) detteOuv[t]= t===0 ? initOuv : detteClot[t-1];
  return {loans:L, interet, capital, nouvelEmp, detteOuv, detteClot, horizon};
}

// ============================================================
//  DÉCISIONS DATÉES — chaque décision applique des deltas
//  aux drivers annuels, à partir de son année de départ.
// ============================================================
// valeur d'un paramètre de décision à l'année t : série « par année » si elle existe, sinon constante.
// dvHas() dit si la trajectoire est pilotée par une série — auquel cas le taux de croissance
// associé au paramètre devient inopérant (on décrit la trajectoire OU on donne base + croissance).
function dv(vv,key,t){ const s=vv.__s&&vv.__s[key]; return s? s[t] : vv[key]; }
function dvHas(vv,key){ return !!(vv.__s&&vv.__s[key]); }

const DECISIONS = [
  {key:"recrut", icon:"", label:"Recrutement",
   desc:"Embaucher du personnel supplémentaire à partir d'une année donnée. Le coût chargé suit sa propre progression salariale : un salaire ne reste pas figé sur tout l'horizon.",
   params:[
     {key:"annee",    lab:"Année d'embauche",            kind:"year",  v:1},
     {key:"effectif", lab:"Nombre de personnes",         kind:"unit",  v:1, min:0, max:500, step:1, per:true},
     {key:"cout",     lab:"Coût chargé / an / personne", kind:"money", v:55000, min:0, max:200000, step:5000, per:true},
   ],
   apply:(vv,drv)=>{
     for(let t=vv.annee;t<NY;t++) drv.perso[t] += dv(vv,'effectif',t) * dv(vv,'cout',t);
   }},

  {key:"gamme", icon:"", label:"Élargir la gamme",
   desc:"Lancer une nouvelle référence produit à partir d'une année donnée, avec son propre prix et son propre coût unitaire. Elle s'ajoute aux références existantes, change le mix et donc le taux de marge, et apparaît dans l'onglet « Par référence ».",
   params:[
     {key:"annee",  lab:"Année de lancement",   kind:"year",  v:2},
     {key:"volN",   lab:"Volume (année 1)",      kind:"unit",  v:1500, min:0, max:1000000, step:100, per:true},
     {key:"prixN",  lab:"Prix unitaire",         kind:"money", v:85, min:0, max:100000, step:5, per:true},
     {key:"coutN",  lab:"Coût unitaire",         kind:"money", v:45, min:0, max:100000, step:5, per:true},
     {key:"capex",  lab:"Invest. de lancement",  kind:"money", v:80000, min:0, max:1000000, step:10000},
     {key:"cf",     lab:"Charges fixes / an",    kind:"money", v:0, min:0, max:1000000, step:5000, per:true},
   ],
   // crée une VRAIE référence datée (0 avant le lancement), avec sa propre économie prix/coût :
   // elle s'agrège dans ca=Σvol·prix et chgv=Σvol·cout comme les autres, et modifie donc le mix.
   apply:(vv,drv,nom)=>{
     const N=NY, vol=new Array(N).fill(0), prix=new Array(N).fill(0), cout=new Array(N).fill(0);
     for(let t=vv.annee;t<N;t++){
       // trajectoire décrite dans la modale « par année » (valeur ou croissance), sinon constante
       vol[t] = dv(vv,'volN',t);
       prix[t]= dv(vv,'prixN',t);
       cout[t]= dv(vv,'coutN',t);
       drv.ca[t]   += vol[t]*prix[t];
       drv.chgv[t] += vol[t]*cout[t];
       drv.cf[t]   += dv(vv,'cf',t);  // structure récurrente du lancement (marketing, chef de produit…)
     }
     drv.refB.push({nom:nom||"Nouvelle gamme", vol, prix, cout});
     drv.capex[vv.annee]+=vv.capex;
   }},

  {key:"usine", icon:"", label:"Ouvrir un site",
   desc:"Nouveau site (usine, entrepôt, magasin…) : gros CAPEX financé par emprunt, charges fixes récurrentes, et capacité supplémentaire à écouler. Le volume gagné se décrit référence par référence — un site ne fait pas croître toutes les gammes de la même façon.",
   params:[
     {key:"annee",     lab:"Année de mise en service",     kind:"year",  v:2},
     {key:"capex",     lab:"Investissement (CAPEX)",       kind:"money", v:800000, min:0, max:5000000, step:50000},
     {key:"dureeAmor", lab:"Durée d'amortissement du site",kind:"years", v:20, min:1, max:40, step:1},
     {key:"emprunt",   lab:"Financé par emprunt",          kind:"money", v:600000, min:0, max:5000000, step:50000},
     {key:"tauxEmp",   lab:"Taux de l'emprunt",            kind:"pct",   v:5.5, min:0, max:20, step:0.25},
     {key:"dureeEmp",  lab:"Durée de l'emprunt (ans)",     kind:"years", v:10, min:1, max:25, step:1},
     {key:"cf",        lab:"Charges fixes / an",           kind:"money", v:120000, min:0, max:1000000, step:10000, per:true},
     {key:"capacites", lab:"Capacité par référence",       kind:"refcap", v:{}},
   ],
   // Le volume supplémentaire est saisi PAR RÉFÉRENCE, en unités, avec sa propre trajectoire
   // (valeur ou croissance, année par année) : la montée en charge se décrit dans la trajectoire,
   // il n'y a donc plus de pourcentages « 1ʳᵉ / 2ᵉ année » à renseigner à côté.
   apply:(vv,drv)=>{
     // le site s'amortit sur SA durée (bâtiment = 20-30 ans), pas sur la durée moyenne du parc
     drv.capexL.push({annee:vv.annee, montant:vv.capex, duree:vv.dureeAmor});
     const caps=(vv.capacites && typeof vv.capacites==='object')? vv.capacites : {};
     for(let t=vv.annee;t<NY;t++){
       drv.cf[t]+=dv(vv,'cf',t);               // les charges fixes tombent dès la mise en service
       drv.refB.forEach(r=>{
         const s=caps[r.nom]; if(!s) return;
         const add=Math.max(0, +s[t]||0);      // volume supplémentaire écoulé grâce au site
         if(!add) return;
         r.vol[t]  += add;
         drv.ca[t]   += add*r.prix[t];
         drv.chgv[t] += add*r.cout[t];
       });
     }
   },
   // l'emprunt du site rejoint le portefeuille en annuités constantes (tiré l'année de mise en service)
   applyLoan:(vv,nom)=> vv.emprunt>0 ? {nom:"Emprunt — "+(nom||"site"), montant:vv.emprunt, taux:vv.tauxEmp*100, duree:vv.dureeEmp, depart:vv.annee} : null},

  {key:"capital", icon:"", label:"Ouverture de capital",
   desc:"Lever des fonds propres : les actionnaires (ou de nouveaux investisseurs) injectent du cash. Renforce la trésorerie et les capitaux propres, sans dette.",
   params:[
     {key:"annee",   lab:"Année de l'opération", kind:"year",  v:1},
     {key:"montant", lab:"Montant levé",         kind:"money", v:300000, min:0, max:5000000, step:50000},
   ],
   apply:(vv,drv)=>{ drv.equityInj[vv.annee]+=vv.montant; }},

  {key:"rachat", icon:"", label:"Rachat de parts",
   desc:"Opération inverse de l'ouverture de capital : l'entreprise rachète ses propres parts aux actionnaires. Sortie de cash et réduction des capitaux propres.",
   params:[
     {key:"annee",   lab:"Année de l'opération", kind:"year",  v:2},
     {key:"montant", lab:"Montant racheté",      kind:"money", v:200000, min:0, max:5000000, step:50000},
   ],
   apply:(vv,drv)=>{ drv.equityInj[vv.annee]-=vv.montant; }},

  {key:"cession", icon:"", label:"Cession d'activité",
   desc:"Vendre une partie de l'activité : encaissement du prix de cession, sortie des actifs cédés (plus/moins-value au résultat), et disparition du CA, des charges fixes et du personnel associés. La part cédée se ventile référence par référence — céder une activité ne rabote pas toutes les gammes uniformément.",
   params:[
     {key:"annee",       lab:"Année de cession",             kind:"year",  v:2},
     {key:"prix",        lab:"Prix de cession",              kind:"money", v:400000, min:0, max:10000000, step:50000},
     {key:"vnc",         lab:"Valeur nette comptable cédée", kind:"money", v:300000, min:0, max:10000000, step:50000},
     {key:"parts",       lab:"Part cédée, par référence",    kind:"refsplit", v:{}},
     {key:"baisseCF",    lab:"Baisse charges fixes / an",    kind:"money", v:30000, min:0, max:1000000, step:10000, per:true},
     {key:"baissePerso", lab:"Baisse charges de personnel / an", kind:"money", v:0, min:0, max:1000000, step:10000, per:true},
   ],
   apply:(vv,drv)=>{
     drv.proceedsCession[vv.annee]+=vv.prix;
     drv.nbvCession[vv.annee]+=vv.vnc;
     drv.gainCession[vv.annee]+=(vv.prix - vv.vnc);        // plus-value (+) ou moins-value (−)
     const parts=(vv.parts && typeof vv.parts==='object')? vv.parts : {};
     for(let t=vv.annee;t<NY;t++){
       // l'activité cédée disparaît référence par référence (CA ET charges variables)
       let caPerdu=0, cvPerdu=0;
       drv.refB.forEach(r=>{
         const p=Math.min(1, Math.max(0, (+parts[r.nom]||0)/100));
         if(p<=0) return;
         caPerdu += r.vol[t]*p*r.prix[t];
         cvPerdu += r.vol[t]*p*r.cout[t];
         r.vol[t]*=(1-p);
       });
       drv.ca[t]   -= caPerdu;
       drv.chgv[t] -= cvPerdu;
       drv.cf[t]    = Math.max(0, drv.cf[t]-dv(vv,'baisseCF',t));      // ni ses charges fixes…
       drv.perso[t] = Math.max(0, drv.perso[t]-dv(vv,'baissePerso',t)); // …ni ses salariés
     }
   }},
];

// ============================================================
//  DÉCISIONS — instances nommées (templates DECISIONS instanciés N fois)
// ============================================================
function decType(type){ return DECISIONS.find(t=>t.key===type) || DECISIONS[0]; }
function uid(){ return 'di'+Date.now().toString(36)+Math.floor(Math.random()*1e5).toString(36); }
// clone les valeurs par défaut : un param de type objet (refsplit) serait sinon PARTAGÉ
// entre toutes les instances, et modifier l'une modifierait les autres.
const cloneVal = v => (v && typeof v==='object') ? JSON.parse(JSON.stringify(v)) : v;
function defVals(t){ const o={}; t.params.forEach(p=>o[p.key]=cloneVal(p.v)); return o; }
function defaultInstances(){ return []; }   // aucune décision préchargée : l'utilisateur les ajoute via la liste « Décisions à simuler »
function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
let decInstances = defaultInstances();
// normalise une instance venue d'un état sauvegardé (complète les params manquants, vérifie le type)
function normalizeInstance(o){
  const t=decType(o&&o.type), vals=defVals(t);
  if(o&&o.vals) t.params.forEach(p=>{ if(o.vals[p.key]!=null) vals[p.key]=cloneVal(o.vals[p.key]); });
  // `ov` (trajectoires « par année ») est stocké À PART de `vals` : la valeur en N reste ainsi
  // toujours pilotable par son champ, y compris quand une croissance s'applique dessus.
  const ov={};
  if(o&&o.ov&&typeof o.ov==='object') t.params.forEach(p=>{ if(o.ov[p.key]) ov[p.key]=cloneVal(o.ov[p.key]); });
  return {id:(o&&o.id)||uid(), type:t.key, nom:(o&&o.nom)||t.label, active:!!(o&&o.active), vals, ov};
}
// reconstruit la liste d'instances depuis un état : format instances, sinon migration ancien format {dec:{key:{...}}}
function instancesFromState(s){
  if(s && Array.isArray(s.decInstances)) return s.decInstances.map(normalizeInstance);
  if(s && s.dec && typeof s.dec==='object'){
    return DECISIONS.filter(t=>s.dec[t.key]).map(t=>{
      const o=s.dec[t.key]||{}, vals=defVals(t);
      t.params.forEach(p=>{ if(o[p.key]!=null) vals[p.key]=o[p.key]; });
      return {id:uid(), type:t.key, nom:o.nom||t.label, active:!!o.active, vals};
    });
  }
  return defaultInstances();
}
// instance (valeurs d'affichage) -> décision prête pour compute (valeurs moteur, apply/applyLoan résolus)
function toEngineDec(ins){
  const t=decType(ins.type), vals={};
  t.params.forEach(p=>{
    // la ventilation par référence est un OBJET {nom: %} : parseFloat la détruirait (NaN → 0)
    if(p.kind==='refsplit'){
      const src=(ins.vals[p.key] && typeof ins.vals[p.key]==='object')? ins.vals[p.key] : {};
      const o={}; Object.keys(src).forEach(k=>{ const n=parseFloat(src[k]); if(!isNaN(n)) o[k]=n; });
      vals[p.key]=o; return;
    }
    // capacité par référence : {réf: {v, ov}} -> {réf: série de NY volumes}, développée ici
    // pour que `apply` n'ait plus qu'à lire une valeur par année.
    if(p.kind==='refcap'){
      const src=(ins.vals[p.key] && typeof ins.vals[p.key]==='object')? ins.vals[p.key] : {};
      const t0=parseInt(ins.vals.annee,10)||0;
      const o={};
      Object.keys(src).forEach(k=>{
        const e=src[k]||{}, base=parseFloat(e.v)||0;
        if(!base && !e.ov) return;
        o[k]= e.ov ? ovSeries(e.ov, base, t0) : new Array(NY).fill(base);
      });
      vals[p.key]=o; return;
    }
    let v=parseFloat(ins.vals[p.key]); if(isNaN(v))v=0;
    const div = p.kind==='pct' ? 100 : 1;
    vals[p.key]= v/div;
    // trajectoire « par année » : développée à partir de la valeur en N saisie dans le champ,
    // qui reste donc pleinement modifiable même en mode croissance.
    const o = ins.ov && ins.ov[p.key];
    if(o){
      const t0=parseInt(ins.vals.annee,10)||0;   // la trajectoire démarre à l'année de la décision
      const s=ovSeries(o, v, t0);
      if(s){ vals.__s=vals.__s||{}; vals.__s[p.key]=s.map(x=>x/div); }
    }
  });
  return {id:ins.id, type:ins.type, nom:(ins.nom||t.label), active:!!ins.active, vals, apply:t.apply, applyLoan:t.applyLoan};
}
// synchronise le DOM (source de vérité pendant l'édition) vers decInstances, avant toute reconstruction/sauvegarde
function syncDecFromDOM(){
  decInstances.forEach(ins=>{
    const chk=document.getElementById('dec_'+ins.id); if(!chk) return;
    ins.active=chk.checked;
    const nm=document.getElementById('decname_'+ins.id); if(nm) ins.nom=nm.value;
    decType(ins.type).params.forEach(p=>{
      if(p.kind==='refsplit'){   // pas d'input unique : un champ par référence
        const o={};
        document.querySelectorAll('.dp-refin[data-dk="'+ins.id+'"]').forEach(inp=>{ o[inp.dataset.ref]=parseFloat(inp.value)||0; });
        ins.vals[p.key]=o; return;
      }
      // capacité par référence : saisie dans sa propre modale, qui écrit directement
      // dans ins.vals — surtout ne pas l'écraser depuis la carte de décision.
      if(p.kind==='refcap') return;
      const el=document.getElementById('dp_'+ins.id+'_'+p.key); if(el) ins.vals[p.key]=el.value;
    });
  });
}
function nextName(t){ const n=decInstances.filter(i=>i.type===t.key).length; return n? t.label+' '+(n+1) : t.label; }
function addDecision(type){ syncDecFromDOM(); const t=decType(type); decInstances.push({id:uid(), type:t.key, nom:nextName(t), active:true, vals:defVals(t), ov:{}}); buildDecisions(); refresh(); }
function delDecision(id){ syncDecFromDOM(); decInstances=decInstances.filter(i=>i.id!==id); buildDecisions(); refresh(); }

// ---- Formatage français ----
const fEUR = x => isFinite(x)? new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(x) : "—";
const fPCT = x => isFinite(x)? (x*100).toFixed(1).replace('.',',')+' %' : "—";
const fX   = x => isFinite(x)? x.toFixed(1).replace('.',',')+'×' : "n.s.";
const fJ   = x => isFinite(x)? Math.round(x)+' j' : "—";
const fNB  = x => isFinite(x)? new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(x) : "—";
const cls  = x => x<0 ? "neg" : "pos";
// infobulle pédagogique (title natif, robuste) — esc() défini plus bas (hoisté)
const tipHTML = txt => `<span class="tip" title="${esc(txt)}">i</span>`;

// ============================================================
//  MOTEUR — drivers annuels (base + décisions) puis cascade comptable
// ============================================================
// ============================================================
//  OVERRIDES PAR ANNÉE — un paramètre peut suivre sa trajectoire auto (base+croissance/constante)
//  ou une série personnalisée saisie année par année.
// ============================================================
const PERYEAR_KEYS = ['capex','cfN','persoN','tauxIS','DSO','DPO','DIO','tauxDiv'];
const ITEM = {}; GROUPS.flatMap(g=>g.items).forEach(it=>ITEM[it.key]=it);
// key -> trajectoire (valeurs par année ou croissance), en unité d'AFFICHAGE ; absent = valeur constante.
// Par défaut on inflate les charges : sans cela le CA croît pendant que les coûts restent figés
// en nominal, et le résultat s'envole pour de mauvaises raisons (un DAF le voit tout de suite).
let overrides = {
  cfN:    croissance(2),   // charges fixes : inflation
  persoN: croissance(3),   // personnel : inflation + progression salariale
};
const numOf = k => { const el=document.getElementById('num_'+k); return el? (parseFloat(el.value)||0) : (ITEM[k]?ITEM[k].v:0); };
// valeur de la trajectoire auto, en unité d'affichage (sert à pré-remplir / prolonger un override)
function autoVal(key,t){
  switch(key){
    // la trajectoire d'un paramètre se décrit désormais UNIQUEMENT dans la modale « par année »
    // (valeur ou croissance) : plus de taux de croissance en doublon dans le panneau.
    default:      return numOf(key);   // valeur en N, constante par défaut
  }
}
// ajuste les séries « par année » des références au nouvel horizon (prolonge en auto / tronque)
function reconcileRefs(){
  refs.forEach(r=>REF_METRICS.forEach(c=>{
    const o=ovNorm(r[c.ov]); if(!o) return;
    if(o.kind==='values'){
      const a=o.v.slice(0,NY);
      for(let t=a.length;t<NY;t++) a.push(a.length?a[a.length-1]:(+r[c.base]||0));
      o.v=a;
    }else{
      const a=o.r.slice(0,NY);
      for(let t=a.length;t<NY;t++) a.push(a.length?a[a.length-1]:0);
      o.r=a;
    }
    r[c.ov]=o;
  }));
}
// ajuste toutes les séries d'override à la longueur NY (au changement d'horizon) : prolonge en auto, tronque si besoin
function reconcileOverrides(){
  PERYEAR_KEYS.forEach(k=>{
    const o=ovNorm(overrides[k]); if(!o) return;
    if(o.kind==='values'){
      const a=o.v.slice(0,NY);
      for(let t=a.length;t<NY;t++) a.push(autoVal(k,t));
      o.v=a;
    }else{
      const a=o.r.slice(0,NY);
      for(let t=a.length;t<NY;t++) a.push(a.length?a[a.length-1]:0);
      o.r=a;
    }
    overrides[k]=o;
  });
}
const ovRound = v => Math.round(v*100)/100;

// ============================================================
//  SAISIE « PAR ANNÉE » — socle commun aux hypothèses ET aux paramètres de décision
//  Deux modes : VALEURS (un montant par année) ou CROISSANCE (un taux par année,
//  chaîné sur l'année PRÉCÉDENTE — « +10 % en N+1 et N+2, puis +5 % » se lit directement).
//  L'absence d'override = trajectoire auto (valeur en N + croissance unique).
// ============================================================
function ovNorm(o){
  if(!o) return null;
  // ⚠️ conserver `mode` et `base` : ce sont eux qui portent l'état de la modale
  if(Array.isArray(o)) return {kind:'values', mode:'year', v:o.slice()};   // ancien format (tableau nu)
  if(o.kind==='rates')  return {kind:'rates',  mode:o.mode||'const', base:o.base, r:(o.r||[]).slice()};
  if(o.kind==='values') return {kind:'values', mode:o.mode||'const', base:o.base, v:(o.v||[]).slice()};
  return null;
}
// développe un override en série de NY valeurs.
// `base` = valeur de départ ; `t0` = année où la trajectoire démarre (0 pour une hypothèse,
// l'année de la décision pour un paramètre de décision — une gamme lancée en N+2 part de N+2).
function ovSeries(o, base, t0){
  const n=ovNorm(o); if(!n) return null;
  const s=Math.min(NY-1, Math.max(0, t0|0));
  const out=new Array(NY).fill(0);
  if(n.kind==='values'){
    for(let t=0;t<NY;t++){
      const v=n.v[t];
      out[t] = (v!=null && v!=='' && isFinite(+v)) ? +v : (t>0? out[t-1] : (+base||0));
    }
    return out;
  }
  for(let t=0;t<=s;t++) out[t]=+base||0;             // rien ne précède l'année de départ
  for(let t=s+1;t<NY;t++){
    const r=(n.r[t]!=null && isFinite(+n.r[t]))? +n.r[t] : 0;
    out[t]=out[t-1]*(1+r/100);
  }
  return out;
}
const ovKind = o => (ovNorm(o)||{}).kind || null;

// ---- Modale « gérer année par année » (partagée par tous les paramètres overridables) ----
// Un CONTEXTE la rend indépendante de la source : hypothèses globales (overrides[key])
// ou paramètre d'une décision (ins.vals[key]). Mêmes modes, mêmes règles, deux stockages.
let ymKey=null, ymCtx=null;
function ymGet(){ return ymCtx? ymCtx.get() : null; }
function ymSet(o){ if(ymCtx) ymCtx.set(o); }
function ymBase(){ return ymCtx? (+ymCtx.base()||0) : 0; }
function ymSetBase(v){ if(ymCtx&&ymCtx.setBase) ymCtx.setBase(v); }
function ymT0(){ return (ymCtx&&ymCtx.t0)? Math.min(NY-1, Math.max(0, ymCtx.t0()|0)) : 0; }
function ymAutoAt(t){ return (ymCtx&&ymCtx.auto)? ymCtx.auto(t) : ymBase(); }
function ymItem(){ return (ymCtx&&ymCtx.it)? ymCtx.it : {kind:'num', step:1}; }
function ymCurSerie(){ return ovSeries(ymGet(), ymBase(), ymT0()) || Array.from({length:NY},(_,t)=>ymAutoAt(t)); }
function buildYearModal(){
  const m=document.createElement('div'); m.className='modal-overlay'; m.id='yearModal';
  m.innerHTML=`<div class="modal" style="max-width:560px">
    <div class="modal-head"><h2><span id="ymTitle"></span></h2>
      <button class="modal-close" id="ymClose" title="Fermer">✕</button></div>
    <p class="modal-sub" id="ymSub"></p>
    <div class="ym-mode">
      <button class="loan-modebtn" id="ymValues">Valeur</button>
      <button class="loan-modebtn" id="ymRates">Croissance</button>
    </div>
    <div class="ym-mode ym-mode2">
      <button class="loan-modebtn" id="ymConst">Identique chaque année</button>
      <button class="loan-modebtn" id="ymYear">Choisir par année</button>
    </div>
    <div id="ymBody">
      <div class="ym-apply" id="ymConstRow"><span id="ymApplyLab">Valeur appliquée chaque année :</span>
        <input type="number" id="ymAll" class="numfield">
        <span class="ym-unit-inline" id="ymUnit"></span></div>
      <div id="ymYears" class="ym-years"></div>
      <p class="ym-hint" id="ymHint"></p>
    </div>
    <div class="modal-foot"><span id="ymInfo"></span><button class="btn-primary" id="ymDone">Terminé</button></div>
  </div>`;
  document.body.appendChild(m);
  document.getElementById('ymClose').addEventListener('click',()=>m.classList.remove('open'));
  document.getElementById('ymDone').addEventListener('click',()=>m.classList.remove('open'));
  m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
  // --- mode : VALEUR ou CROISSANCE (on repart toujours de la trajectoire affichée) ---
  document.getElementById('ymValues').addEventListener('click',()=>{ ymApply('values', ymModeNow()); });
  document.getElementById('ymRates').addEventListener('click', ()=>{ ymApply('rates',  ymModeNow()); });
  // --- saisie : IDENTIQUE chaque année, ou une valeur PAR ANNÉE ---
  document.getElementById('ymConst').addEventListener('click',()=>{ ymApply(ymKindNow(),'const'); });
  document.getElementById('ymYear').addEventListener('click', ()=>{ ymApply(ymKindNow(),'year'); });
  document.getElementById('ymAll').addEventListener('input',e=>{
    const v=parseFloat(e.target.value); if(isNaN(v)) return;
    if(ymKindNow()==='values'){
      ymSetBase(v);            // valeur identique chaque année = c'est le PARAMÈTRE lui-même
    }else{
      const o=ovNorm(ymGet()) || {kind:'rates', r:new Array(NY).fill(0)};
      const t0=ymT0();
      for(let t=t0+1;t<NY;t++) o.r[t]=v;      // un seul taux, appliqué chaque année
      for(let t=0;t<=t0;t++) o.r[t]=0;
      o.mode='const'; ymSet(o);
    }
    updateYmPreview(); refresh();
  });
}
// Quatre combinaisons. « Valeur + identique chaque année » n'est PAS un override :
// c'est le paramètre lui-même, qui doit donc rester pleinement pilotable par son champ.
function ymApply(kind,mode){
  const cur=ymCurSerie(), t0=ymT0();
  if(kind==='values'){
    if(mode==='const'){ ymSetBase(ovRound(cur[t0])); ymSet(null); }
    else ymSet({kind:'values', mode:'year', v:cur.map(ovRound)});
  }else{
    const r=new Array(NY).fill(0);
    for(let t=t0+1;t<NY;t++) r[t]= cur[t-1]? ovRound((cur[t]/cur[t-1]-1)*100) : 0;
    if(mode==='const'){ const x=r[t0+1]||0; for(let t=t0+1;t<NY;t++) r[t]=x; }
    ymSet({kind:'rates', mode, r});
  }
  renderYearModal(); refresh();
}
function ymKindNow(){ return ovKind(ymGet()) || 'values'; }
function ymModeNow(){ const o=ovNorm(ymGet()); return o? (o.mode||'const') : 'const'; }
// formate une valeur d'override selon la nature du paramètre (pour l'aperçu du mode croissance)
function fmtOv(v,it){
  if(!isFinite(v)) return '—';
  if(it.kind==='money') return fEUR(v);
  if(it.kind==='pct')   return (Math.round(v*100)/100).toString().replace('.',',')+' %';
  if(it.kind==='days')  return Math.round(v)+' j';
  return (Math.round(v*100)/100).toString().replace('.',',');
}
// hypothèse globale : la source est overrides[key], la trajectoire de référence est autoVal()
function openYearModal(key){
  ymKey=key;
  const it=ITEM[key];
  openYM({
    lab:it.lab, it,
    get:()=>overrides[key],
    set:o=>{ if(o) overrides[key]=o; else delete overrides[key]; },
    base:()=>autoVal(key,0),
    setBase:v=>{ setVal(key,v); paramChanged(key); },
    auto:t=>autoVal(key,t)
  });
}
// paramètre d'une décision : la source est ins.vals[pk], la référence est la valeur saisie (constante)
function openDecYearModal(insId,pk){
  const ins=decInstances.find(i=>i.id===insId); if(!ins) return;
  const p=decType(ins.type).params.find(x=>x.key===pk); if(!p) return;
  syncDecFromDOM();
  ymKey=insId+'.'+pk;
  const scal=()=>parseFloat(ins.vals[pk])||0;   // la valeur de départ vient du champ, jamais figée dans l'override
  openYM({
    lab:p.lab+' — '+(ins.nom||''), it:{kind:p.kind, step:p.step},
    get:()=>(ins.ov&&ins.ov[pk])||null,
    set:o=>{ ins.ov=ins.ov||{}; if(o) ins.ov[pk]=o; else delete ins.ov[pk]; buildDecisions(); },
    base:scal,
    setBase:v=>{ ins.vals[pk]=v; buildDecisions(); },
    // la trajectoire démarre à l'année de la décision : une gamme lancée en N+2 part de N+2
    t0:()=>parseInt(ins.vals.annee,10)||0,
    auto:()=>scal()
  });
}
// métrique d'une référence produit (volume / prix / coût) : même modale, source = refs[idx][ov]
function openRefYearModal(idx,m){
  const r=refs[idx]; if(!r) return;
  const cfg=REF_METRICS.find(c=>c.m===m); if(!cfg) return;
  const ov=metricOv(m);
  ymKey='ref'+idx+'.'+m;
  openYM({
    lab:cfg.lab+' — '+(r.nom||'Référence'),
    it:{kind: cfg.unit==='€'?'money':'num', step:cfg.step},
    get:()=>r[ov],
    set:o=>{ r[ov]= o||null; renderRefList(); refSummary(); },
    base:()=>+r[cfg.base]||0,
    setBase:v=>{ r[cfg.base]=v; renderRefList(); refSummary(); },
    auto:()=>+r[cfg.base]||0
  });
}
function openYM(ctx){
  ymCtx=ctx;
  const it=ctx.it;
  const unit=it.kind==='pct'?' en %':it.kind==='money'?' en €':it.kind==='days'?' en jours':'';
  document.getElementById('ymTitle').textContent=ctx.lab;
  document.getElementById('ymSub').innerHTML=`Décris ce paramètre en <b>valeur</b>${unit} ou en <b>croissance</b>, puis choisis une saisie <b>identique chaque année</b> ou <b>année par année</b> — utile quand la progression n'est pas linéaire (forte montée, puis palier).`;
  renderYearModal();
  document.getElementById('yearModal').classList.add('open');
}
// met à jour les valeurs calculées affichées à droite des taux, sans reconstruire les champs
// (une reconstruction ferait perdre le focus à chaque frappe)
function updateYmPreview(){
  const it=ymItem(), serie=ymCurSerie();
  if(!serie) return;
  document.querySelectorAll('#ymYears .ym-prev').forEach(e=>{ e.textContent=fmtOv(serie[+e.dataset.t],it); });
}
function renderYearModal(){
  const kind=ymKindNow(), mode=ymModeNow(), it=ymItem(), rates=(kind==='rates'), t0=ymT0();
  document.getElementById('ymValues').classList.toggle('on',!rates);
  document.getElementById('ymRates').classList.toggle('on',rates);
  document.getElementById('ymConst').classList.toggle('on',mode==='const');
  document.getElementById('ymYear').classList.toggle('on',mode==='year');
  const o=ovNorm(ymGet()), serie=ymCurSerie();
  const arr = o ? (rates?o.r:o.v) : serie;
  const constRow=document.getElementById('ymConstRow');
  constRow.hidden=(mode!=='const');
  document.getElementById('ymYears').hidden=(mode==='const');
  document.getElementById('ymApplyLab').textContent = rates
    ? 'Taux de croissance appliqué chaque année :' : 'Valeur appliquée chaque année :';
  document.getElementById('ymUnit').textContent = rates ? '%'
    : (it.kind==='money'?'€':it.kind==='days'?'jours':'');
  if(mode==='const'){
    const cur = rates ? (arr[t0+1]||0) : ovRound(serie[t0]);
    const inp=document.getElementById('ymAll');
    if(document.activeElement!==inp) inp.value=cur;      // ne pas écraser la frappe en cours
    inp.step = rates?0.5:it.step;
  }
  document.getElementById('ymHint').textContent = rates
    ? 'Chaque taux s’applique à l’année précédente. ' + ANNEES[t0] + ' est la valeur de départ : rien ne la précède.'
    : '';
  // on n'affiche que les années où le paramètre existe (une gamme lancée en N+2 démarre en N+2)
  document.getElementById('ymYears').innerHTML=ANNEES.slice(t0).map((a,i)=>{
    const t=t0+i;
    if(rates && t===t0)
      return `<label class="ym-year ym-year-base"><span>${a}</span><b class="ym-prev" data-t="${t}">${fmtOv(serie[t],it)}</b></label>`;
    return `<label class="ym-year"><span>${a}</span>
      <input type="number" class="numfield ym-in" data-t="${t}" step="${rates?0.5:it.step}" value="${arr[t]!=null?arr[t]:0}">
      ${rates?'<i class="ym-unit">%</i><em class="ym-prev" data-t="'+t+'">'+fmtOv(serie[t],it)+'</em>':''}</label>`;
  }).join('');
  document.querySelectorAll('#ymYears .ym-in').forEach(inp=>inp.addEventListener('input',()=>{
    const k=ymKindNow();
    const cur = ovNorm(ymGet()) || (k==='rates'
      ? {kind:'rates',  r:new Array(NY).fill(0)}
      : {kind:'values', v:ymCurSerie().map(ovRound)});
    const t=+inp.dataset.t, v=parseFloat(inp.value);
    if(cur.kind==='rates') cur.r[t]=isNaN(v)?0:v; else cur.v[t]=isNaN(v)?0:v;
    cur.mode='year'; ymSet(cur); updateYmPreview(); refresh();
  }));
}

function buildDrivers(H){
  const N=NY, A=()=>new Array(N).fill(0);
  const cf=A(),perso=A(),capex=A();
  // Plus de multiplicateur de volume global : chaque décision qui touche aux volumes
  // (gamme, site, cession) agit désormais RÉFÉRENCE PAR RÉFÉRENCE. Un rabot uniforme
  // ne décrit aucune décision réelle.
  // canaux d'injection « haut de bilan » alimentés par les décisions (capital / rachat / cession)
  const equityInj=A(),gainCession=A(),nbvCession=A(),proceedsCession=A();
  // poches d'amortissement à durée SPÉCIFIQUE : {annee, montant, duree}. Un bâtiment s'amortit
  // sur 20-30 ans, pas sur la durée moyenne du parc — les mélanger écraserait le résultat des
  // premières années. Le CAPEX courant reste, lui, dans `capex` (durée globale H.duree).
  const capexL=[];
  const ov=H.ov||{};
  // séries par référence (avant multiplicateur de volume) : volume, prix, coût unitaire
  const rs=(H.refs&&H.refs.length)?H.refs:engineRefs(REFS_DEF);
  const refB=rs.map(r=>{
    const vol=A(),prix=A(),cout=A();
    for(let t=0;t<N;t++){
      vol[t] = r.volOv  ? r.volOv[t]  : r.volN;    // trajectoire décrite dans la modale, sinon constante
      prix[t]= r.prixOv ? r.prixOv[t] : r.prixN;
      cout[t]= r.coutOv ? r.coutOv[t] : r.coutN;
    }
    return {nom:r.nom, vol, prix, cout};
  });
  // agrégats du CA et des charges variables = somme des références (hors multiplicateur)
  const ca=A(), chgv=A();
  for(let t=0;t<N;t++) refB.forEach(rb=>{ ca[t]+=rb.vol[t]*rb.prix[t]; chgv[t]+=rb.vol[t]*rb.cout[t]; });
  for(let t=0;t<N;t++){
    cf[t]    = ov.cfN   ? ov.cfN[t]   : H.cfN;      // trajectoire décrite dans la modale « par année »
    perso[t] = ov.persoN? ov.persoN[t]: H.persoN;
    capex[t] = ov.capex ? ov.capex[t] : H.capex;
  }
  return {ca,chgv,refB,cf,perso,capex,capexL,equityInj,gainCession,nbvCession,proceedsCession};
}

function compute(H, decisions){
  const N=NY, R={};
  const drv = buildDrivers(H);
  const loanDefs = (H.loans||LOANS_DEF).slice();
  (decisions||[]).forEach(d=>{
    if(!d.active) return;
    d.apply(d.vals, drv, d.nom);
    if(d.applyLoan){ const l=d.applyLoan(d.vals, d.nom); if(l) loanDefs.push(l); }   // décision qui crée un emprunt (site)
  });
  // ---- Bilan d'ouverture : mode d'équilibrage (plug = trésorerie OU financement déduit) ----
  const BFRouv = H.openStocks + H.openCreances - H.openDettesF;
  let cpOuv0Eff = H.cpOuv0, besoinFin=0, emprAmor=0, apportCap=0;
  if(H.openMode==='funding' && H.fund){
    const openingDebtBase = loanDefs.filter(l=>l.depart==='ouv').reduce((s,l)=>s+(+l.montant||0),0);
    const target=+H.fund.targetCash||0;
    // besoin = ce qu'il manque pour financer immos + BFR + trésorerie cible, au-delà des CP et de la dette déjà en place
    besoinFin = Math.max(0, H.immoOuv0 + BFRouv + target - H.cpOuv0 - openingDebtBase);
    const pd = Math.min(1, Math.max(0, (+H.fund.partDette||0)/100));
    emprAmor = besoinFin*pd; apportCap = besoinFin*(1-pd);
    // la part dette devient un vrai emprunt d'ouverture (s'amortit, génère des intérêts) ; la part capital gonfle les CP d'ouverture
    if(emprAmor>0) loanDefs.push({nom:"Emprunt d'amorçage", montant:emprAmor, taux:(+H.fund.tauxAmor||0), duree:(+H.fund.dureeAmor||1), depart:'ouv'});
    cpOuv0Eff = H.cpOuv0 + apportCap;
  }
  const fin = buildLoans(loanDefs);

  // séries de taux : override par année si présent, sinon constante
  const ov=H.ov||{};
  const ser=(k,def)=> ov[k] ? ov[k] : new Array(N).fill(def);
  const sDSO=ser('DSO',H.DSO), sDPO=ser('DPO',H.DPO), sDIO=ser('DIO',H.DIO), sTauxIS=ser('tauxIS',H.tauxIS), sTauxDiv=ser('tauxDiv',H.tauxDiv);

  const A=()=>new Array(N).fill(0);
  const CA=A(),chgv=A(),marge=A(),EBITDA=A(),
        dot=A(),EBIT=A(),chgfin=A(),RAI=A(),IS=A(),RN=A(),
        creances=A(),stocks=A(),df=A(),BFR=A(),varBFR=A(),bfrJours=A(),
        immoOuv=A(),immoClot=A(),detteOuv=A(),detteClot=A(),
        cpOuv=A(),div=A(),cpClot=A(),
        fExpl=A(),fInv=A(),fFin=A(),varTreso=A(),tresoOuv=A(),tresoClot=A(),
        actif=A(),passif=A(),ctrl=A(),detteNette=A(),levier=A(),ROCE=A(),
        croiss=A(),margeEBITDA=A(),pointMort=A(),margeSecu=A();
  // trésorerie d'ouverture = plug d'équilibre du bilan d'ouverture (Actif ouverture = Passif ouverture).
  // En mode 'funding', cpOuv0Eff et le portefeuille ont été augmentés en amont → openTreso retombe exactement sur la cible.
  const openTreso = cpOuv0Eff + fin.detteOuv[0] - H.immoOuv0 - BFRouv;
  let grossOuv=0;   // valeur brute cumulée des immos à l'ouverture (amortissement linéaire)
  let deficit=0;    // stock de déficit reportable (report des pertes sur l'IS futur)
  // --- poches d'amortissement à durée spécifique (décision « Ouvrir un site ») ---
  // suivies à part de la poche générique : `immoGen` = VNC du parc courant, `vncL` = VNC des poches.
  const poches=(drv.capexL||[]).map(p=>({annee:p.annee|0, montant:+p.montant||0, duree:Math.max(1,+p.duree||1), cum:0}));
  const capexTot=A();
  let immoGen=H.immoOuv0, vncL=0;

  for(let t=0;t<N;t++){
    CA[t]   = drv.ca[t];      // somme des références, décisions déjà appliquées référence par référence
    chgv[t] = drv.chgv[t];
    marge[t]= CA[t]-chgv[t];
    EBITDA[t]= marge[t]-drv.cf[t]-drv.perso[t];
    // immos (tableau roulant) — amortissement linéaire classique (valeur brute cumulée / durée)
    // Poche GÉNÉRIQUE (parc courant, durée H.duree) :
    const immoGenOuv=immoGen;
    grossOuv    = t===0 ? H.immoOuv0 : grossOuv + drv.capex[t-1];
    grossOuv    = Math.max(0, grossOuv - drv.nbvCession[t]);  // cession : sort la base amortissable des actifs cédés
    let dotGen  = grossOuv/H.duree;
    dotGen      = Math.min(dotGen, immoGenOuv+drv.capex[t]);  // jamais en dessous de 0 de valeur nette
    immoGen     = immoGenOuv + drv.capex[t] - dotGen - drv.nbvCession[t];
    // Poches à durée SPÉCIFIQUE : comme la poche générique, le CAPEX de l'année t
    // ne commence à s'amortir qu'en t+1 (même convention, sinon le bilan diverge).
    const vncLOuv=vncL;
    let capexLt=0, dotL=0;
    poches.forEach(p=>{
      if(t===p.annee) capexLt += p.montant;
      if(t>p.annee && p.cum<p.montant){
        const d=Math.min(p.montant/p.duree, p.montant-p.cum);
        p.cum+=d; dotL+=d;
      }
    });
    vncL        = vncLOuv + capexLt - dotL;
    capexTot[t] = drv.capex[t] + capexLt;
    immoOuv[t]  = immoGenOuv + vncLOuv;
    dot[t]      = dotGen + dotL;
    immoClot[t] = immoGen + vncL;
    EBIT[t]     = EBITDA[t]-dot[t];
    // dette — portefeuille d'emprunts en annuités constantes (intérêts sur solde d'ouverture, agrégés).
    detteOuv[t]  = fin.detteOuv[t];
    detteClot[t] = fin.detteClot[t];
    chgfin[t]    = fin.interet[t];
    RAI[t] = EBIT[t]-chgfin[t]+drv.gainCession[t];   // + résultat exceptionnel de cession (plus/moins-value, taxé)
    // IS avec report déficitaire : une perte alimente un stock imputé sur les bénéfices futurs
    if(RAI[t]>0){
      const impute=Math.min(RAI[t], deficit);   // on impute le déficit reporté
      deficit-=impute;
      IS[t]=(RAI[t]-impute)*sTauxIS[t];
    } else {
      IS[t]=0; deficit+=-RAI[t];
    }
    RN[t]  = RAI[t]-IS[t];
    // BFR
    creances[t]= CA[t]*sDSO[t]/365;
    stocks[t]  = chgv[t]*sDIO[t]/365;
    df[t]      = chgv[t]*sDPO[t]/365;
    BFR[t]     = creances[t]+stocks[t]-df[t];
    varBFR[t]  = t===0 ? BFR[t]-BFRouv : BFR[t]-BFR[t-1];
    bfrJours[t]= CA[t]!==0 ? BFR[t]/CA[t]*365 : NaN;
    // capitaux propres — dividende floored à 0 (pas de dividende sur perte)
    const prevRN = t===0 ? H.rnN1 : RN[t-1];
    div[t]   = Math.max(0, prevRN*sTauxDiv[t]);
    cpOuv[t] = t===0 ? cpOuv0Eff : cpClot[t-1];
    cpClot[t]= cpOuv[t] + RN[t] - div[t] + drv.equityInj[t];   // variation de capital (ouverture + / rachat −)
    // tableau de flux (méthode indirecte)
    fExpl[t] = RN[t] + dot[t] - varBFR[t] - drv.gainCession[t];   // la plus-value de cession n'est pas un flux d'exploitation
    fInv[t]  = -capexTot[t] + drv.proceedsCession[t];             // + encaissement du prix de cession
    fFin[t]  = fin.nouvelEmp[t] - fin.capital[t] - div[t] + drv.equityInj[t];   // + ouverture de capital / − rachat de parts
    varTreso[t]= fExpl[t]+fInv[t]+fFin[t];
    tresoOuv[t]= t===0 ? openTreso : tresoClot[t-1];
    tresoClot[t]= tresoOuv[t]+varTreso[t];
    // bilan + contrôle
    actif[t] = immoClot[t]+stocks[t]+creances[t]+tresoClot[t];
    passif[t]= cpClot[t]+detteClot[t]+df[t];
    ctrl[t]  = actif[t]-passif[t];
    // ratios
    detteNette[t]= detteClot[t]-tresoClot[t];
    levier[t]    = EBITDA[t]>0 ? detteNette[t]/EBITDA[t] : NaN;
    const capEng = immoClot[t]+BFR[t];                       // capitaux engagés
    ROCE[t]      = capEng>0 ? EBIT[t]*(1-sTauxIS[t])/capEng : NaN;   // NOPAT (EBIT après impôt) / capitaux engagés
    croiss[t]    = t===0 ? NaN : CA[t]/CA[t-1]-1;
    margeEBITDA[t]= CA[t]!==0 ? EBITDA[t]/CA[t] : NaN;
    const tauxMarge = CA[t]!==0 ? marge[t]/CA[t] : NaN;
    pointMort[t] = tauxMarge>0 ? (drv.cf[t]+drv.perso[t])/tauxMarge : NaN;
    margeSecu[t] = CA[t]!==0 ? (CA[t]-pointMort[t])/CA[t] : NaN;
  }
  // détail par référence (décisions incluses) pour l'onglet d'analyse
  const refSeries = drv.refB.map(rb=>{
    const rca=A(),rvol=A(),rmarge=A();
    for(let t=0;t<N;t++){ rvol[t]=rb.vol[t]; rca[t]=rvol[t]*rb.prix[t]; rmarge[t]=rvol[t]*(rb.prix[t]-rb.cout[t]); }
    return {nom:rb.nom, ca:rca, vol:rvol, prix:rb.prix.slice(), cout:rb.cout.slice(), marge:rmarge};
  });
  // Free cash flow = flux d'exploitation + flux d'investissement (avant financement).
  // C'est le cash que l'entreprise dégage réellement, disponible pour les prêteurs et les actionnaires.
  const FCF=A();
  for(let t=0;t<N;t++) FCF[t]=fExpl[t]+fInv[t];
  Object.assign(R,{CA,chgv,marge,cf:drv.cf,perso:drv.perso,capex:capexTot,EBITDA,dot,EBIT,chgfin,resExcept:drv.gainCession,RAI,IS,RN,div,BFR,varBFR,
    cpClot,tresoClot,detteOuv,detteClot,detteNette,levier,ROCE,bfrJours,croiss,margeEBITDA,pointMort,margeSecu,ctrl,fin,refSeries,openTreso,
    // tableau de flux + bilan : calculés depuis toujours, désormais exposés pour l'affichage
    fExpl,fInv,fFin,FCF,varTreso,tresoOuv,cessions:drv.proceedsCession,
    immoClot,stocks,creances,df,cpOuv,actif,passif,
    // postes du bilan d'ouverture, pour afficher l'équation d'équilibrage en clair
    ouverture:{cp:cpOuv0Eff, dette:fin.detteOuv[0], immo:H.immoOuv0, bfr:BFRouv, treso:openTreso},
    funding:{mode:(H.openMode||'treso'), besoin:besoinFin, emprunt:emprAmor, apport:apportCap}});
  return R;
}

// ============================================================
//  CONTRÔLES — hypothèses
// ============================================================
function buildInputs(){
  const root=document.getElementById('inputs'); root.innerHTML='';
  GROUPS.forEach(g=>{
    const d=document.createElement('details'); if(g.open)d.open=true;
    d.dataset.view = g.view||'sim';   // onglet où le groupe s'affiche : sim | dcf | both
    d.innerHTML=`<summary>${g.titre}</summary>`;
    const wrap=document.createElement('div'); wrap.className='grp';
    g.items.forEach(it=>{
      if(it.derived){   // poste calculé (ex. trésorerie d'ouverture = plug d'équilibre) : lecture seule
        const row=document.createElement('div'); row.className='ctrl ctrl-derived'; row.dataset.key=it.key;
        row.innerHTML=`<label><span>${it.lab}${it.tip?tipHTML(it.tip):''}</span><b id="lab_${it.key}"></b></label>`;
        wrap.appendChild(row); d.appendChild(wrap); return;
      }
      const per = PERYEAR_KEYS.indexOf(it.key)>=0;
      const row=document.createElement('div'); row.className='ctrl'; row.dataset.key=it.key;
      // Plus de curseur : la saisie se fait au clavier ou aux boutons − / +. Un curseur
      // ne permet pas de poser une valeur précise, et c'est toujours ce qu'on veut ici.
      row.innerHTML=`
        <label for="num_${it.key}"><span>${it.lab}${it.tip?tipHTML(it.tip):''}</span><b id="lab_${it.key}"></b></label>
        <div class="row">
          <div class="stepper">
            <button type="button" class="st-btn" data-k="${it.key}" data-d="-1">−</button>
            <input type="number" id="num_${it.key}" class="numfield" min="${it.min}" max="${it.max}" step="${it.step}" value="${it.v}">
            <button type="button" class="st-btn" data-k="${it.key}" data-d="1">+</button>
          </div>
          ${per?`<button type="button" class="yr-btn" data-k="${it.key}" title="Décrire l'évolution : valeur ou croissance, identique chaque année ou année par année">Évolution</button>`:''}
        </div>`;
      wrap.appendChild(row);
      d.appendChild(wrap);
    });
    root.appendChild(d);
  });
  GROUPS.flatMap(g=>g.items).forEach(it=>{
    if(it.derived) return;
    const num=document.getElementById('num_'+it.key);
    num.addEventListener('input',()=>paramChanged(it.key));
  });
  root.querySelectorAll('.yr-btn').forEach(b=>b.addEventListener('click',()=>openYearModal(b.dataset.k)));
  root.querySelectorAll('.st-btn').forEach(b=>{
    b.addEventListener('click',()=>{
      const it=GROUPS.flatMap(g=>g.items).find(x=>x.key===b.dataset.k);
      if(it) stepVal(it, parseInt(b.dataset.d,10));
    });
  });
}
// ---- Mode d'équilibrage du bilan d'ouverture (injecté dans le groupe « Bilan d'ouverture ») ----
function buildOpeningMode(){
  const anchor=document.querySelector('#inputs .ctrl[data-key="tresoOuv0"]');
  if(!anchor) return;
  const box=document.createElement('div'); box.className='open-mode'; box.id='openModeCtrl';
  box.innerHTML=`
    <div class="om-label">Équilibrer le bilan d'ouverture</div>
    <div class="om-intro">Un bilan doit être équilibré : l'actif est toujours égal au passif.
      Vous saisissez tous les postes sauf un — celui qui reste se déduit des autres.
      Choisissez lequel.</div>
    <div class="ym-mode">
      <button class="loan-modebtn" id="omTreso" type="button">Déduire la trésorerie</button>
      <button class="loan-modebtn" id="omFund" type="button">Déduire le financement</button>
    </div>
    <div class="om-explain" id="omExplain"></div>
    <div class="om-readout" id="fund_readout"></div>
    <div id="omFundBox" class="om-fundbox" hidden>
      <div class="om-field"><label>Trésorerie d'ouverture cible</label>
        <input type="number" id="fund_targetCash" class="numfield" step="5000" value="${fund.targetCash}"></div>
      <div class="om-field"><label>Part financée par dette&nbsp;: <b id="fund_partLab">${fund.partDette}&nbsp;%</b> <span class="om-hint">(reste en apport de capital)</span></label>
        <input type="number" id="fund_partDette" class="numfield" min="0" max="100" step="5" value="${fund.partDette}"></div>
      <div class="om-field"><label>Taux de l'emprunt d'amorçage (%)</label>
        <input type="number" id="fund_tauxAmor" class="numfield" step="0.25" value="${fund.tauxAmor}"></div>
      <div class="om-field"><label>Durée de l'emprunt d'amorçage (ans)</label>
        <input type="number" id="fund_dureeAmor" class="numfield" min="1" max="25" step="1" value="${fund.dureeAmor}"></div>
    </div>`;
  anchor.parentNode.insertBefore(box, anchor);
  document.getElementById('omTreso').addEventListener('click',()=>{ openMode='treso';   renderOpeningMode(); refresh(); });
  document.getElementById('omFund') .addEventListener('click',()=>{ openMode='funding'; renderOpeningMode(); refresh(); });
  const bind=(id,key,isRange)=>{ const el=document.getElementById(id);
    el.addEventListener('input',()=>{ fund[key]=parseFloat(el.value)||0; if(isRange){ const pl=document.getElementById('fund_partLab'); if(pl) pl.textContent=fund.partDette+' %'; } refresh(); }); };
  bind('fund_targetCash','targetCash'); bind('fund_partDette','partDette',true);
  bind('fund_tauxAmor','tauxAmor');     bind('fund_dureeAmor','dureeAmor');
  renderOpeningMode();
}
function renderOpeningMode(){
  const f=(openMode==='funding');
  const bt=document.getElementById('omTreso'), bf=document.getElementById('omFund');
  if(bt) bt.classList.toggle('on',!f); if(bf) bf.classList.toggle('on',f);
  const box=document.getElementById('omFundBox'); if(box) box.hidden=!f;
  const ex=document.getElementById('omExplain');
  if(ex) ex.innerHTML = f
    ? `Vous fixez la trésorerie que vous voulez avoir en caisse au démarrage. Le modèle en déduit
       <b>le financement à lever</b> pour y arriver, et le répartit entre emprunt et apport en capital.
       La question posée&nbsp;: <i>combien dois-je lever&nbsp;?</i>`
    : `Vous saisissez les capitaux propres et la dette d'ouverture. La trésorerie est le <b>solde</b>
       qui fait tomber le bilan à l'équilibre. La question posée&nbsp;: <i>avec ce financement,
       combien me reste-t-il en caisse&nbsp;?</i>`;
  const trow=document.querySelector('#inputs .ctrl[data-key="tresoOuv0"]'); if(trow) trow.style.display=f?'none':'';   // la ligne « tréso calculée » est redondante en mode financement
}
function syncFundInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
  set('fund_targetCash',fund.targetCash); set('fund_partDette',fund.partDette);
  set('fund_tauxAmor',fund.tauxAmor); set('fund_dureeAmor',fund.dureeAmor);
  const pl=document.getElementById('fund_partLab'); if(pl) pl.textContent=fund.partDette+' %';
}
// Affiche l'équilibrage du bilan d'ouverture EN CHIFFRES, dans les deux modes :
// on montre l'équation posée, pas seulement son résultat.
function updateFundReadout(R){
  const el=document.getElementById('fund_readout'); if(!el) return;
  const o=R.ouverture; if(!o){ el.innerHTML=''; return; }
  const eq = `<div class="om-eq">`
    + `<span>Capitaux propres <b>${fEUR(o.cp)}</b></span>`
    + `<span>+ Dettes financières <b>${fEUR(o.dette)}</b></span>`
    + `<span>− Immobilisations <b>${fEUR(o.immo)}</b></span>`
    + `<span>− BFR d'ouverture <b>${fEUR(o.bfr)}</b></span>`
    + `<span class="om-eq-res">= Trésorerie d'ouverture <b>${fEUR(o.treso)}</b></span>`
    + `</div>`;
  if(openMode!=='funding' || !R.funding){ el.innerHTML=eq; return; }
  const fd=R.funding;
  el.innerHTML = eq + (fd.besoin>0
    ? `<div class="om-need">Besoin de financement&nbsp;: <b>${fEUR(fd.besoin)}</b><br>
       → emprunt d'amorçage <b>${fEUR(fd.emprunt)}</b> · apport en capital <b>${fEUR(fd.apport)}</b></div>`
    : `<div class="om-need">Bilan d'ouverture déjà couvert — aucun financement à lever (trésorerie ≥ cible).</div>`);
}
function stepVal(it,dir){
  const num=document.getElementById('num_'+it.key);
  let v=(parseFloat(num.value)||0)+dir*it.step;
  v=Math.max(it.min, Math.min(it.max, v));
  v=parseFloat(v.toFixed(6));
  num.value=v; paramChanged(it.key);
}
// un changement de paramètre : si c'est l'horizon, on reconstruit les années avant de recalculer
function paramChanged(key){ if(key==='nbAnnees') applyHorizon(); else refresh(); }
function applyHorizon(){
  const n=Math.max(3, Math.min(10, Math.round(parseFloat(document.getElementById('num_nbAnnees').value)||5)));
  setVal('nbAnnees', n);
  NY=n; ANNEES=mkYears(n);
  reconcileOverrides();   // ajuste les séries par année au nouvel horizon
  reconcileRefs();        // idem pour les séries par année des références
  if(document.getElementById('refList')) renderRefList();
  rebuildYearSelects();
  refresh();
}
// reconstruit les listes déroulantes « année » des décisions selon l'horizon (sélection conservée, bornée)
function rebuildYearSelects(){
  decInstances.forEach(ins=>decType(ins.type).params.forEach(p=>{
    if(p.kind!=='year') return;
    const sel=document.getElementById('dp_'+ins.id+'_'+p.key); if(!sel) return;
    const cur=Math.min(parseInt(sel.value||'0',10)||0, NY-1);
    sel.innerHTML=ANNEES.map((a,i)=>`<option value="${i}" ${i===cur?'selected':''}>${a}</option>`).join('');
  }));
}

function readH(){
  const H={};
  GROUPS.flatMap(g=>g.items).forEach(it=>{
    if(it.derived) return;   // poste calculé par le moteur (pas de champ de saisie)
    // le champ numérique (num_) est la source de vérité : saisie précise possible,
    // sans le snapping au pas du curseur (in_).
    let v=parseFloat(document.getElementById('num_'+it.key).value);
    if(isNaN(v))v=0;
    H[it.key] = it.kind==='pct' ? v/100 : v;
  });
  H.loans = financeLoans;
  H.refs = engineRefs(refs);   // références produits (unités moteur)
  H.ov = {};   // overrides par année (unités moteur : pct /100)
  PERYEAR_KEYS.forEach(k=>{
    const s=ovSeries(overrides[k], autoVal(k,0));
    if(s){ const pct=ITEM[k].kind==='pct'; H.ov[k]= pct? s.map(v=>v/100) : s; }
  });
  H.openMode=openMode; H.fund={...fund};
  return H;
}
function setVal(key,val){
  const n=document.getElementById('num_'+key);
  if(n){n.value=val;}
}

// ============================================================
//  CONTRÔLES — décisions
// ============================================================
// noms des références connues : celles saisies à la main + celles créées par les décisions
// « gamme » actives. Lu sans passer par decisionRefs() pour ne pas resynchroniser le DOM en plein rendu.
function knownRefNames(){
  const n=refs.map(r=>r.nom||'Référence');
  decInstances.filter(i=>i.active && i.type==='gamme').forEach(i=>n.push(i.nom||'Nouvelle gamme'));
  return n.filter((x,i)=>n.indexOf(x)===i);
}
function decParamHTML(dk,p,val){
  const v=(val!=null && val!=='')? val : p.v;
  const id='dp_'+dk+'_'+p.key;
  // ventilation par référence : un pourcentage de baisse propre à chaque référence
  if(p.kind==='refsplit'){
    const cur=(val && typeof val==='object')? val : {};
    const names=knownRefNames();
    const rows=names.map(n=>`<label class="dp-ref"><span>${escAttr(n)}</span>
        <input type="number" class="numfield dp-refin" data-dk="${dk}" data-ref="${escAttr(n)}"
               min="0" max="100" step="5" value="${+cur[n]||0}"><i>%</i></label>`).join('');
    return `<div class="dp dp-split"><label>${p.lab}</label>
      <div class="dp-refs">${rows||'<span class="dp-none">Aucune référence à céder.</span>'}</div></div>`;
  }
  // capacité par référence : la carte n'affiche qu'un résumé + un bouton, la saisie est en modale
  if(p.kind==='refcap'){
    const cur=(val && typeof val==='object')? val : {};
    let n=0, tot=0;
    Object.keys(cur).forEach(k=>{ const e=cur[k]||{}; const b=parseFloat(e.v)||0;
      if(b || e.ov){ n++; tot+=b; } });
    const resume = n
      ? `${n} référence${n>1?'s':''} · +${fNB(tot)} unités en année 1`
      : 'Aucune capacité répartie';
    return `<div class="dp dp-cap-row"><label>${p.lab}</label>
      <div class="dp-cap-side">
        <span class="dp-cap-sum ${n?'on':''}">${resume}</span>
        <button type="button" class="yr-btn dp-cap ${n?'on':''}" data-dk="${dk}" data-pk="${p.key}"
                title="Répartir le volume supplémentaire référence par référence">Répartir…</button>
      </div></div>`;
  }
  if(p.kind==='year'){
    const cur=Math.min(parseInt(v,10)||0, NY-1);
    const opts=ANNEES.map((a,i)=>`<option value="${i}" ${i===cur?'selected':''}>${a}</option>`).join('');
    return `<div class="dp"><label>${p.lab}</label><select id="${id}">${opts}</select></div>`;
  }
  const suf=p.kind==='pct'?' %':'';
  const ins=decInstances.find(i=>i.id===dk);
  const ok=(ins&&ins.ov)?ovKind(ins.ov[p.key]):null;
  const yr = p.per?`<button type="button" class="yr-btn dp-yr ${ok?'on':''}" data-dk="${dk}" data-pk="${p.key}" title="Décrire l'évolution : valeur ou croissance, identique chaque année ou année par année">Évolution</button>`:'';
  // Le champ reste TOUJOURS affiché : en mode croissance c'est la valeur de départ sur laquelle
  // s'appliquent les taux. Il n'est neutralisé qu'en « valeurs par année », où il perd son sens.
  // Pas d'étiquette de mode ici : elle pousserait le bouton « Évolution » hors du cadre —
  // son état actif (fond bleu) suffit à signaler qu'une trajectoire est définie.
  return `<div class="dp ${ok==='values'?'dp-locked':''}"><label>${p.lab}${suf?' ('+suf.trim()+')':''}</label>
     <div class="stepper">
       <button type="button" class="st-btn dp-btn" data-dk="${dk}" data-pk="${p.key}" data-d="-1">−</button>
       <input type="number" id="${id}" class="numfield" value="${v}" min="${p.min}" max="${p.max}" step="${p.step}">
       <button type="button" class="st-btn dp-btn" data-dk="${dk}" data-pk="${p.key}" data-d="1">+</button>
     </div>${yr}</div>`;
}
function decCardHTML(ins){
  const t=decType(ins.type);
  return `<div class="dec ${ins.active?'on':''}" id="card_${ins.id}">
      <div class="dec-head">
        <input type="checkbox" class="dec-chk" id="dec_${ins.id}" ${ins.active?'checked':''}>
        <input class="dec-name" id="decname_${ins.id}" value="${escAttr(ins.nom)}" title="Renommer cette décision">
        <button type="button" class="dec-del" data-del="${ins.id}" title="Supprimer">✕</button>
      </div>
      <div class="dec-body" id="decbody_${ins.id}" style="display:${ins.active?'block':'none'}">
        <div class="dec-desc">${t.desc}</div>
        ${t.params.map(p=>decParamHTML(ins.id,p,ins.vals[p.key])).join('')}
      </div></div>`;
}
function buildDecisions(){
  const root=document.getElementById('decisions'); root.innerHTML='';
  decInstances.forEach(ins=>root.insertAdjacentHTML('beforeend', decCardHTML(ins)));
  const opts=DECISIONS.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
  root.insertAdjacentHTML('beforeend',
    `<div class="dec-add"><select id="decAddType">${opts}</select>`+
    `<button type="button" class="dec-add-btn" id="decAddBtn">＋ Ajouter</button></div>`);
  // câblage par instance : toggle, nom éditable, champs
  decInstances.forEach(ins=>{
    const chk=document.getElementById('dec_'+ins.id);
    const body=document.getElementById('decbody_'+ins.id);
    const card=document.getElementById('card_'+ins.id);
    chk.addEventListener('change',()=>{
      ins.active=chk.checked;
      body.style.display=chk.checked?'block':'none';
      card.classList.toggle('on',chk.checked); refresh();
    });
    const nm=document.getElementById('decname_'+ins.id);
    if(nm) nm.addEventListener('input',()=>{ ins.nom=nm.value; refresh(); });   // le nom pilote la réf (gamme) et la barre de simulation
    decType(ins.type).params.forEach(p=>{
      const el=document.getElementById('dp_'+ins.id+'_'+p.key);
      if(el) el.addEventListener('input',refresh);
    });
    // champs de ventilation par référence (un input par référence, pas d'id unique)
    if(body) body.querySelectorAll('.dp-refin').forEach(inp=>inp.addEventListener('input',refresh));
  });
  // bouton « an » des paramètres de décision : ouvre la modale par année sur ce paramètre
  root.querySelectorAll('.dp-yr').forEach(b=>b.addEventListener('click',()=>openDecYearModal(b.dataset.dk,b.dataset.pk)));
  root.querySelectorAll('.dp-cap').forEach(b=>b.addEventListener('click',()=>openCapModal(b.dataset.dk,b.dataset.pk)));
  // steppers +/- (data-dk = id d'instance, param résolu via son type)
  root.querySelectorAll('.dp-btn').forEach(b=>b.addEventListener('click',()=>{
    const ins=decInstances.find(i=>i.id===b.dataset.dk); if(!ins) return;
    const p=decType(ins.type).params.find(x=>x.key===b.dataset.pk); if(!p) return;
    const el=document.getElementById('dp_'+b.dataset.dk+'_'+b.dataset.pk);
    let v=(parseFloat(el.value)||0)+parseInt(b.dataset.d,10)*p.step;
    v=Math.max(p.min, Math.min(p.max, v)); v=parseFloat(v.toFixed(6));
    el.value=v; refresh();
  }));
  // supprimer une instance / ajouter une nouvelle décision
  root.querySelectorAll('.dec-del').forEach(b=>b.addEventListener('click',()=>delDecision(b.dataset.del)));
  const addBtn=document.getElementById('decAddBtn');
  if(addBtn) addBtn.addEventListener('click',()=>addDecision(document.getElementById('decAddType').value));
}
// ============================================================
//  ÉDITEUR D'EMPRUNTS (modale) — portefeuille en annuités constantes
// ============================================================
let financeLoans = JSON.parse(JSON.stringify(LOANS_DEF));   // source de vérité du portefeuille
const fEURm = x => isFinite(x)? new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(x)+' €/mois' : "—";

function loanStepper(idx,field,val,step){
  return `<div class="stepper">
    <button type="button" class="st-btn loan-st" data-idx="${idx}" data-field="${field}" data-step="${step}" data-d="-1">−</button>
    <input type="number" class="numfield loan-num" data-idx="${idx}" data-field="${field}" step="${step}" value="${val}">
    <button type="button" class="st-btn loan-st" data-idx="${idx}" data-field="${field}" data-step="${step}" data-d="1">+</button>
  </div>`;
}
function loanCardHTML(l,idx){
  const depOpts = `<option value="ouv" ${l.depart==='ouv'?'selected':''}>Ouverture</option>`
    + ANNEES.map((a,i)=>`<option value="${i}" ${String(l.depart)===String(i)?'selected':''}>${a}</option>`).join('');
  const calc = `<div class="loan-calc">Mensualité calculée <b>${fEURm(loanMensualite(l))}</b></div>`;
  return `<div class="loan-card" data-idx="${idx}">
    <div class="loan-top">
      <input class="loan-nom" data-idx="${idx}" data-field="nom" value="${esc(l.nom||'Emprunt')}" placeholder="Nom de l'emprunt">
      <button class="loan-del" data-idx="${idx}" title="Supprimer cet emprunt">✕</button>
    </div>
    <div class="loan-grid">
      <label>Montant emprunté ${loanStepper(idx,'montant',l.montant,10000)}</label>
      <label>Taux d'intérêt (%) ${loanStepper(idx,'taux',l.taux,0.25)}</label>
      <label>Année de tirage
        <select class="loan-sel" data-idx="${idx}" data-field="depart">${depOpts}</select></label>
    </div>
    <div class="loan-grid">
      <label>Durée (années) ${loanStepper(idx,'duree',l.duree,1)}</label>
      ${calc}
    </div>
  </div>`;
}
function renderLoanList(){
  const root=document.getElementById('loanList'); if(!root) return;
  root.innerHTML = financeLoans.length
    ? financeLoans.map((l,i)=>loanCardHTML(l,i)).join('')
    : '<div class="scn-empty">Aucun emprunt. Ajoute-en un — ou laisse vide (aucune dette).</div>';
}
function updateLoanCalc(idx){
  const card=document.querySelector(`.loan-card[data-idx="${idx}"]`); if(!card) return;
  const l=financeLoans[idx], b=card.querySelector('.loan-calc b'); if(!b) return;
  b.textContent = fEURm(loanMensualite(l));
}
function buildFinanceModal(){
  const modal=document.createElement('div'); modal.className='modal-overlay'; modal.id='finModal';
  modal.innerHTML=`
    <div class="modal">
      <div class="modal-head"><h2>Portefeuille d'emprunts</h2>
        <button class="modal-close" id="finClose" title="Fermer">✕</button></div>
      <p class="modal-sub">Chaque emprunt est modélisé en <b>annuités constantes</b> : mensualité fixe, les intérêts baissent et le capital remboursé monte au fil du temps.
        « Ouverture » = dette déjà en cours au départ (pas d'encaissement). Le montant, le taux et la <b>durée</b> sont saisis ; la mensualité (annuité) est calculée automatiquement.</p>
      <div id="loanList"></div>
      <button class="scn-btn" id="loanAdd" style="margin-top:8px;width:auto;padding:9px 16px">＋ Ajouter un emprunt</button>
      <div class="modal-foot"><span id="finSummary"></span>
        <button class="btn-primary" id="finDone">Terminé</button></div>
    </div>`;
  document.body.appendChild(modal);
  renderLoanList();
  const root=document.getElementById('loanList');
  root.addEventListener('input',e=>{
    const el=e.target; if(!el.classList.contains('loan-num') && !el.classList.contains('loan-nom')) return;
    const idx=+el.dataset.idx, f=el.dataset.field;
    financeLoans[idx][f]= f==='nom'? el.value : (parseFloat(el.value)||0);
    updateLoanCalc(idx); finSummary(); refresh();
  });
  root.addEventListener('change',e=>{
    const el=e.target; if(!el.classList.contains('loan-sel')) return;
    financeLoans[+el.dataset.idx].depart = el.value==='ouv'?'ouv':parseInt(el.value,10);
    finSummary(); refresh();
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.classList.contains('loan-st')){
      const idx=+b.dataset.idx, f=b.dataset.field, step=parseFloat(b.dataset.step), d=parseInt(b.dataset.d,10);
      let v=(parseFloat(financeLoans[idx][f])||0)+d*step; v=Math.max(0, parseFloat(v.toFixed(6)));
      financeLoans[idx][f]=v;
      const num=root.querySelector(`.loan-num[data-idx="${idx}"][data-field="${f}"]`); if(num) num.value=v;
      updateLoanCalc(idx); finSummary(); refresh();
    } else if(b.classList.contains('loan-del')){
      financeLoans.splice(+b.dataset.idx,1); renderLoanList(); finSummary(); refresh();
    }
  });
  document.getElementById('loanAdd').addEventListener('click',()=>{
    financeLoans.push({nom:'Nouvel emprunt', montant:200000, taux:5, duree:7, depart:1});
    renderLoanList(); finSummary(); refresh();
  });
  document.getElementById('finOpen').addEventListener('click',()=>modal.classList.add('open'));
  document.getElementById('finClose').addEventListener('click',()=>modal.classList.remove('open'));
  document.getElementById('finDone').addEventListener('click',()=>modal.classList.remove('open'));
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
  finSummary();
}
function finSummary(){
  const fin=buildLoans(financeLoans);
  const totalDette=financeLoans.reduce((a,l)=>a+(+l.montant||0),0);
  const totalInt=fin.interet.reduce((a,b)=>a+b,0);
  const el=document.getElementById('finSummary');
  if(el) el.innerHTML=`${financeLoans.length} emprunt${financeLoans.length>1?'s':''} · capital <b>${fEUR(totalDette)}</b> · intérêts totaux <b>${fEUR(totalInt)}</b>`;
}

// ============================================================
//  ÉDITEUR DE RÉFÉRENCES PRODUITS
// ============================================================
function refStepper(idx,field,val,step){
  return `<div class="stepper">
    <button type="button" class="st-btn ref-st" data-idx="${idx}" data-field="${field}" data-step="${step}" data-d="-1">−</button>
    <input type="number" class="numfield ref-num" data-idx="${idx}" data-field="${field}" step="${step}" value="${val}">
    <button type="button" class="st-btn ref-st" data-idx="${idx}" data-field="${field}" data-step="${step}" data-d="1">+</button>
  </div>`;
}
function refMetricHTML(r,idx,cfg){
  const kind=ovKind(r[cfg.ov]);
  const suf=cfg.unit?` (${cfg.unit})`:'';
  const tag = kind ? `<span class="dp-pertag">${kind==='rates'?'croissance':'par année'}</span>` : '';
  // la valeur en N reste éditable : c'est la base sur laquelle s'appliquent d'éventuels taux.
  // Seul le mode « valeurs par année » la neutralise, puisqu'elle y perd son sens.
  return `<div class="ref-metric ${kind==='values'?'dp-locked':''}">
    <div class="ref-metric-head"><span class="ref-metric-lab">${cfg.lab}</span>
      ${tag}<button type="button" class="yr-btn ref-yr ${kind?'on':''}" data-idx="${idx}" data-metric="${cfg.m}"
        title="Décrire l'évolution : valeur ou croissance, identique chaque année ou année par année">Évolution</button></div>
    <div class="ref-auto"><label>En N${suf} ${refStepper(idx,cfg.base,r[cfg.base],cfg.step)}</label></div></div>`;
}
function refCardHTML(r,idx){
  return `<div class="ref-card" data-idx="${idx}">
    <div class="loan-top">
      <input class="loan-nom ref-nom" data-idx="${idx}" value="${esc(r.nom||'Référence')}" placeholder="Nom de la référence">
      <button class="loan-del ref-del" data-idx="${idx}" title="Supprimer cette référence">✕</button></div>
    ${REF_METRICS.map(c=>refMetricHTML(r,idx,c)).join('')}
    <div class="ref-card-foot" id="refFoot_${idx}"></div>
  </div>`;
}
function refFootHTML(r){
  const v=refN(r,'volN','volOv'), p=refN(r,'prixN','prixOv'), c=refN(r,'coutN','coutOv');
  const caN=v*p, mN=v*(p-c), tx=caN?mN/caN*100:0;
  return `CA en N <b>${fEUR(caN)}</b> · marge sur CV <b>${fEUR(mN)}</b> <span class="ref-tx">(${tx.toFixed(0)} %)</span>`;
}
function updateRefFoot(idx){ const f=document.getElementById('refFoot_'+idx); if(f) f.innerHTML=refFootHTML(refs[idx]); }
// Références créées par les décisions actives de type « gamme ».
// Elles ne vivent PAS dans `refs` : la décision reste leur SEULE source de vérité.
// On les affiche donc en LECTURE SEULE — deux endroits de saisie pour les mêmes
// chiffres finiraient forcément par diverger (la décision réécrit tout au calcul).
function decisionRefs(){
  syncDecFromDOM();
  return decInstances.filter(ins=>ins.active && ins.type==='gamme').map(ins=>{
    const v=ins.vals||{}, n=k=>(parseFloat(v[k])||0);
    return {id:ins.id, nom:ins.nom||'Nouvelle gamme',
            annee:Math.max(0,Math.min(parseInt(v.annee,10)||0, NY-1)),
            volN:n('volN'), gVol:n('gVol'), prixN:n('prixN'),
            gPrix:n('gPrix'), coutN:n('coutN'), gCout:n('gCout')};
  });
}
function decRefCardHTML(d){
  const lanc=ANNEES[d.annee]||('N+'+d.annee);
  const ca=d.volN*d.prixN, mg=d.volN*(d.prixN-d.coutN), tx=ca?mg/ca*100:0;
  const pct=g=>(g>=0?'+':'')+String(g).replace('.',',')+' %/an';
  const line=(lab,val,g)=>`<div class="dref-m"><span>${lab}</span><b>${val}</b><i>${pct(g)}</i></div>`;
  return `<div class="ref-card ref-card-ro">
    <div class="loan-top"><span class="dref-nom">${esc(d.nom)}</span>
      <span class="dref-tag">issue d'une décision</span></div>
    <div class="dref-body">
      ${line('Volume', Math.round(d.volN).toLocaleString('fr-FR'), d.gVol)}
      ${line('Prix unitaire', fEUR(d.prixN), d.gPrix)}
      ${line('Coût variable unitaire', fEUR(d.coutN), d.gCout)}
    </div>
    <div class="ref-card-foot">Lancement en <b>${lanc}</b> · la 1ʳᵉ année : CA <b>${fEUR(ca)}</b> · marge <b>${fEUR(mg)}</b> <span class="ref-tx">(${tx.toFixed(0)} %)</span></div>
    <div class="dref-note">Ces valeurs appartiennent à la décision « ${esc(d.nom)} » : elles se modifient dans sa carte, sous « Décisions à simuler ».</div>
  </div>`;
}
function renderRefList(){
  const root=document.getElementById('refList'); if(!root) return;
  const dr=decisionRefs();
  const own = refs.length ? refs.map((r,i)=>refCardHTML(r,i)).join('')
    : '<div class="scn-empty">Aucune référence. Ajoutes-en une (sans référence, le CA est nul).</div>';
  const fromDec = dr.length
    ? `<div class="dref-sep">Références issues des décisions actives</div>` + dr.map(decRefCardHTML).join('')
    : '';
  root.innerHTML = own + fromDec;
  refs.forEach((r,i)=>updateRefFoot(i));
}
function refSummary(){
  let caN=0,mN=0; refs.forEach(r=>{ const v=refN(r,'volN','volOv'), p=refN(r,'prixN','prixOv'), c=refN(r,'coutN','coutOv'); caN+=v*p; mN+=v*(p-c); });
  const tx=caN?(mN/caN*100):0;
  // les références issues des décisions sont comptées à part : elles démarrent souvent après N,
  // les agréger au « CA en N » donnerait un total trompeur.
  const nd=(typeof decInstances!=='undefined') ? decInstances.filter(i=>i.active&&i.type==='gamme').length : 0;
  const suf=nd?` <span class="ref-tx">+ ${nd} issue${nd>1?'s':''} des décisions</span>`:'';
  const txt=`${refs.length} référence${refs.length>1?'s':''} · CA en N <b>${fEUR(caN)}</b> · marge <b>${fEUR(mN)}</b> <span class="ref-tx">(${tx.toFixed(0)} %)</span>${suf}`;
  const a=document.getElementById('refModalSum'); if(a) a.innerHTML=txt;
  const b=document.getElementById('refSummaryPanel'); if(b) b.innerHTML=txt;
}
// ============================================================
//  MODALE « CAPACITÉ PAR RÉFÉRENCE » (décision « Ouvrir un site »)
//  Un site n'augmente pas toutes les gammes de la même façon : on saisit, pour chaque
//  référence, le volume supplémentaire écoulé, avec sa propre trajectoire de montée en charge.
// ============================================================
let capCtx=null;   // {insId, pk}
function capBag(refName){
  const ins=decInstances.find(i=>i.id===capCtx.insId); if(!ins) return null;
  const pk=capCtx.pk;
  if(!ins.vals[pk] || typeof ins.vals[pk]!=='object') ins.vals[pk]={};
  if(!ins.vals[pk][refName] || typeof ins.vals[pk][refName]!=='object') ins.vals[pk][refName]={v:0, ov:null};
  return ins.vals[pk][refName];
}
function openCapModal(insId,pk){
  syncDecFromDOM();
  capCtx={insId,pk};
  renderCapList();
  document.getElementById('capModal').classList.add('open');
}
// trajectoire d'UNE référence : même modale « Évolution » que partout ailleurs
function openCapYearModal(refName){
  const ins=decInstances.find(i=>i.id===capCtx.insId); if(!ins) return;
  ymKey=capCtx.insId+'.'+capCtx.pk+'.'+refName;
  openYM({
    lab:'Capacité — '+refName,
    it:{kind:'num', step:100},
    get:()=>capBag(refName).ov,
    set:o=>{ capBag(refName).ov = o||null; renderCapList(); refresh(); },
    base:()=>+capBag(refName).v||0,
    setBase:v=>{ capBag(refName).v=v; renderCapList(); refresh(); },
    // la montée en charge démarre à l'année de mise en service du site
    t0:()=>parseInt(ins.vals.annee,10)||0,
    auto:()=>+capBag(refName).v||0
  });
}
function renderCapList(){
  const root=document.getElementById('capList'); if(!root || !capCtx) return;
  const ins=decInstances.find(i=>i.id===capCtx.insId); if(!ins) return;
  const an=parseInt(ins.vals.annee,10)||0;
  const names=knownRefNames();
  root.innerHTML = names.length ? names.map(n=>{
    const e=capBag(n);
    const k=ovKind(e.ov);
    const traj = k==='rates' ? 'croissance' : k==='values' ? 'année par année' : 'constant';
    return `<div class="cap-row">
      <span class="cap-nom">${escAttr(n)}</span>
      <span class="cap-in">
        <input type="number" class="numfield cap-num" data-ref="${escAttr(n)}"
               step="100" value="${+e.v||0}"><i>unités</i></span>
      <button type="button" class="yr-btn cap-yr ${k?'on':''}" data-ref="${escAttr(n)}"
              title="Décrire la montée en charge : valeur ou croissance, année par année">Évolution</button>
      <span class="cap-traj">${traj}</span>
    </div>`;
  }).join('') : '<div class="scn-empty">Aucune référence produit à alimenter.</div>';
  capSummary();
}
// résumé du pied de modale — séparé du rendu de la liste pour pouvoir le rafraîchir
// pendant la saisie sans reconstruire les champs (et donc sans perdre le focus)
function capSummary(){
  const sum=document.getElementById('capSum'); if(!sum || !capCtx) return;
  const ins=decInstances.find(i=>i.id===capCtx.insId); if(!ins) return;
  const an=Math.min(parseInt(ins.vals.annee,10)||0, NY-1);
  let tot=0, ca=0;
  knownRefNames().forEach(n=>{
    const b=+capBag(n).v||0; tot+=b;
    const r=refs.find(x=>(x.nom||'Référence')===n);
    if(r) ca += b*refN(r,'prixN','prixOv');
  });
  sum.innerHTML = tot
    ? `+ <b>${fNB(tot)}</b> unités dès ${ANNEES[an]} · environ <b>${fEUR(ca)}</b> de chiffre d'affaires supplémentaire`
    : `Aucun volume saisi — le site coûterait sans rien rapporter.`;
}
function buildCapModal(){
  const modal=document.createElement('div'); modal.className='modal-overlay'; modal.id='capModal';
  modal.innerHTML=`<div class="modal" style="max-width:680px">
    <div class="modal-head"><h2>Capacité supplémentaire par référence</h2>
      <button class="modal-close" id="capClose" title="Fermer">✕</button></div>
    <p class="modal-sub">Un site n'augmente pas toutes les gammes de la même façon. Indiquez, pour chaque référence, le <b>volume supplémentaire</b> (en unités) que le site permet d'écouler à partir de sa mise en service. Le bouton <b>« Évolution »</b> décrit la <b>montée en charge</b> — en valeur ou en croissance, identique chaque année ou année par année.</p>
    <div id="capList"></div>
    <div class="modal-foot"><span id="capSum"></span><button class="btn-primary" id="capDone">Terminé</button></div>
  </div>`;
  document.body.appendChild(modal);
  const root=document.getElementById('capList');
  root.addEventListener('input',e=>{
    const el=e.target;
    if(el.classList.contains('cap-num')){
      capBag(el.dataset.ref).v = parseFloat(el.value)||0;
      // ⚠️ surtout PAS renderCapList() ici : reconstruire la liste ferait perdre
      // le focus du champ à chaque frappe. On ne rafraîchit que le résumé.
      capSummary(); refresh();
    }
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button.cap-yr'); if(!b) return;
    openCapYearModal(b.dataset.ref);
  });
  const close=()=>{ modal.classList.remove('open'); buildDecisions(); refresh(); };
  document.getElementById('capClose').addEventListener('click',close);
  document.getElementById('capDone').addEventListener('click',close);
  modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
}

function buildRefModal(){
  const modal=document.createElement('div'); modal.className='modal-overlay'; modal.id='refModal';
  modal.innerHTML=`<div class="modal" style="max-width:760px">
    <div class="modal-head"><h2>Références produits</h2>
      <button class="modal-close" id="refClose" title="Fermer">✕</button></div>
    <p class="modal-sub">Chaque référence a son <b>volume</b>, son <b>prix unitaire</b> et son <b>coût variable unitaire</b> (marge = prix − coût). Le CA et les charges variables du business plan sont la <b>somme</b> des références. La <b>valeur en N</b> est la base ; le bouton <b>« an »</b> décrit son évolution — en valeur ou en croissance, identique chaque année ou année par année.</p>
    <div id="refList"></div>
    <button class="scn-btn" id="refAdd" style="margin-top:8px;width:auto;padding:9px 16px">＋ Ajouter une référence</button>
    <div class="modal-foot"><span id="refModalSum"></span><button class="btn-primary" id="refDone">Terminé</button></div>
  </div>`;
  document.body.appendChild(modal);
  renderRefList();
  const root=document.getElementById('refList');
  root.addEventListener('input',e=>{
    const el=e.target;
    if(el.classList.contains('ref-nom')){ refs[+el.dataset.idx].nom=el.value; refSummary(); refresh(); return; }
    if(el.classList.contains('ref-num')){ refs[+el.dataset.idx][el.dataset.field]=parseFloat(el.value)||0; updateRefFoot(+el.dataset.idx); refSummary(); refresh(); return; }
    if(el.classList.contains('ref-yr-in')){ const r=refs[+el.dataset.idx], ov=metricOv(el.dataset.metric); if(Array.isArray(r[ov])){ r[ov][+el.dataset.t]=parseFloat(el.value)||0; updateRefFoot(+el.dataset.idx); refSummary(); refresh(); } return; }
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.classList.contains('ref-st')){
      const idx=+b.dataset.idx, f=b.dataset.field, step=parseFloat(b.dataset.step), d=parseInt(b.dataset.d,10);
      // les CROISSANCES (gVol/gPrix/gCout) peuvent être négatives — coût variable qui baisse,
      // volume d'un produit mature qui décline. Seules les valeurs de base restent ≥ 0.
      const isGrowth=/^g[A-Z]/.test(f);
      let v=(parseFloat(refs[idx][f])||0)+d*step; v=parseFloat(v.toFixed(6));
      if(!isGrowth) v=Math.max(0,v);
      refs[idx][f]=v;
      const num=root.querySelector(`.ref-num[data-idx="${idx}"][data-field="${f}"]`); if(num) num.value=v;
      updateRefFoot(idx); refSummary(); refresh();
    } else if(b.classList.contains('ref-yr')){
      openRefYearModal(+b.dataset.idx, b.dataset.metric);
    } else if(b.classList.contains('ref-del')){
      refs.splice(+b.dataset.idx,1); renderRefList(); refSummary(); refresh();
    }
  });
  document.getElementById('refAdd').addEventListener('click',()=>{
    refs.push({id:'r'+Date.now(), nom:'Nouvelle référence', volN:2000, prixN:60, coutN:30, volOv:null, prixOv:null, coutOv:null});
    renderRefList(); refSummary(); refresh();
  });
  // re-rendu à l'ouverture : les références issues des décisions doivent refléter
  // l'état courant des cartes de décision, qui a pu changer depuis le dernier rendu.
  document.getElementById('refOpen').addEventListener('click',()=>{ renderRefList(); refSummary(); modal.classList.add('open'); });
  document.getElementById('refClose').addEventListener('click',()=>modal.classList.remove('open'));
  document.getElementById('refDone').addEventListener('click',()=>modal.classList.remove('open'));
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
  refSummary();
}

function readDecisions(){
  syncDecFromDOM();                          // DOM -> decInstances (source de vérité pendant l'édition)
  return decInstances.map(toEngineDec);      // -> décisions prêtes pour compute
}

// ============================================================
//  RENDU
// ============================================================
let charts={}; let lastR=null, lastR0=null, lastAnyDec=false, lastH=null;
let currentView='sim', currentSub='apercu';
function refresh(){
  const H=readH();
  const decs=readDecisions();
  const R  = compute(H, decs);
  lastR=R; lastH=H;   // dernier calcul, pour l'export CSV et le changement d'onglet
  const R0 = compute(H, []);              // trajectoire de base (sans décision, même échéancier)
  const activeList = decs.filter(d=>d.active);
  const anyDec = activeList.length>0;
  lastR0=R0; lastAnyDec=anyDec;

  GROUPS.flatMap(g=>g.items).forEach(it=>{
    const lab=document.getElementById('lab_'+it.key);
    if(it.derived){ if(lab && it.key==='tresoOuv0') lab.textContent=fEUR(R.openTreso); return; }
    // En mode CROISSANCE, le champ reste la VALEUR EN N sur laquelle s'appliquent les taux :
    // il doit rester pilotable. On ne neutralise le champ qu'en mode « valeurs », où il n'a plus de sens.
    const ovK = PERYEAR_KEYS.indexOf(it.key)>=0 ? ovKind(overrides[it.key]) : null;
    const row=document.querySelector('.ctrl[data-key="'+it.key+'"]');
    if(row){ row.classList.toggle('ov-on', ovK==='values'); row.classList.toggle('ov-rate', ovK==='rates'); }
    const yb=row&&row.querySelector('.yr-btn'); if(yb) yb.classList.toggle('on', !!ovK);
    if(ovK==='values'){ lab.textContent='par année'; return; }
    const v=document.getElementById('num_'+it.key).value;   // aligné sur la source de vérité
    const suf=it.kind==='pct'?' %':it.kind==='days'?' j':it.kind==='years'?' ans':'';
    const disp = (it.kind==='money')? fEUR(parseFloat(v)) : (parseFloat(v).toLocaleString('fr-FR')+suf);
    lab.textContent=disp;
  });

  // barre de simulation
  const bar=document.getElementById('simbar');
  bar.classList.toggle('on',anyDec);
  if(anyDec){
    const noms=activeList.map(d=>{
      return esc(d.nom)+' (dès '+ANNEES[d.vals.annee]+')';
    }).join(' · ');
    document.getElementById('simtxt').innerHTML=
      `<b>Simulation active</b> — ${noms}. Les résultats intègrent ${activeList.length>1?'ces décisions':'cette décision'}.`;
  }

  // en-tête de vue et sous-titres contextuels
  const hSub=document.getElementById('hSub');
  if(hSub) hSub.textContent =
    `${refs.length} référence${refs.length>1?'s':''} · ${ANNEES[0]} → ${ANNEES[NY-1]} · `
    + (anyDec ? `${activeList.length} décision${activeList.length>1?'s':''} active${activeList.length>1?'s':''}`
              : 'aucune décision active');
  const tSub=document.getElementById('tresoSub');
  if(tSub) tSub.textContent = 'point bas en '+ANNEES[lowIdx(R)];

  updateFundReadout(R);
  renderKPIs(R,H); renderStructure(R,H); renderStickybar(R); renderConseiller(R,H);
  renderTable(R); renderMiniTable(R); renderFinance(R); renderRefsAnalysis(R); renderDCF(R,H);   // parties DOM (sûres même onglet masqué)
  renderActiveCharts();                                     // graphes du seul onglet visible
  saveState(); updatePrintHead();
}
// dessine uniquement les graphes de la vue visible (Chart.js dimensionne mal un canvas masqué)
function renderActiveCharts(){
  if(!lastR) return;
  if(currentView==='sim'){
    if(currentSub==='apercu')     renderCharts(lastR);
    else if(currentSub==='refs')  renderRefsCharts(lastR);
    else                          renderFinanceCharts(lastR);
  } else if(currentView==='dcf'){ renderDCFCharts(lastR,lastH); }
}
function switchView(name){
  currentView=name;
  document.querySelectorAll('.view').forEach(v=>{ v.hidden = (v.id!=='view-'+name); });
  // le tiroir est contextuel : sections et groupes d'hypothèses filtrés par vue.
  // Le pack financier dépend des mêmes hypothèses que la simulation.
  const key = (name==='pack') ? 'sim' : name;
  const show=v=>(v===key||v==='both');
  document.querySelectorAll('.aside-sec').forEach(s=>{ s.hidden = !show(s.dataset.view||'sim'); });
  document.querySelectorAll('#inputs details').forEach(d=>{ d.hidden = !show(d.dataset.view||'sim'); });
  renderActiveCharts();
}
function switchSub(name){
  currentSub=name;
  document.querySelectorAll('.subview').forEach(v=>{ v.hidden = (v.id!=='sub-'+name); });
  renderActiveCharts();
}

// ---- Navigation par le rail : chaque entrée = un couple (vue, sous-vue) ----
const NAV = {
  apercu:{view:'sim',  sub:'apercu'},
  refs:  {view:'sim',  sub:'refs'},
  fin:   {view:'sim',  sub:'fin'},
  dcf:   {view:'dcf',  sub:null},
  pack:  {view:'pack', sub:null},
};
function navigate(name){
  const d=NAV[name]; if(!d) return;
  switchView(d.view);
  if(d.sub) switchSub(d.sub);
  document.querySelectorAll('.rail .nav[data-go]').forEach(b=>b.classList.toggle('on', b.dataset.go===name));
  const m=document.querySelector('main'); if(m) m.scrollTop=0;
}

// ============================================================
//  KPI — 4 épinglés par l'utilisateur en tête, le reste en bande compacte
// ============================================================
// Chaque KPI porte une SOUS-LIGNE de contexte (dénominateur, année, seuil) : un chiffre
// seul ne se lit pas. L'ancien écart « vs base » a été retiré — la comparaison de
// scénarios vit dans « Comparer ».
// yr:true → le libellé reçoit le suffixe de la dernière année. get() lit R[..][NY-1] à l'appel.

// Postes d'analyse financière absents du moteur, dérivés du bilan.
const bfrVal = (R,t)=> (R.stocks[t]||0) + (R.creances[t]||0) - (R.df[t]||0);
const frVal  = (R,t)=> (R.cpClot[t]||0) + (R.detteClot[t]||0) - (R.immoClot[t]||0);
const lowIdx = R => R.tresoClot.reduce((b,v,i,a)=> v<a[b]?i:b, 0);   // année du point bas
const ratio2 = x => isFinite(x)? '×'+x.toFixed(2).replace('.',',') : '—';

const KPI_DEFS = [
  {id:'ca', lab:"Chiffre d'affaires", yr:true, get:R=>R.CA[NY-1], fmt:fEUR,
    tip:"Chiffre d'affaires prévu en dernière année (volume × prix).",
    sub:R=>{ const c0=R.CA[0]||0, cN=R.CA[NY-1]||0;
             if(c0<=0 || NY<2) return '';
             const m=cN/c0, t=Math.pow(m,1/(NY-1))-1;
             return `${ratio2(m)} vs ${ANNEES[0]} · TCAM <b>${fPCT(t)}</b>`; }},
  {id:'margeEBITDA', lab:"Marge EBITDA", yr:true, get:R=>R.margeEBITDA[NY-1], fmt:fPCT,
    tip:"EBITDA / CA. Profitabilité opérationnelle avant amortissements, intérêts et impôts.",
    sub:R=>`<b>${fEUR(R.EBITDA[NY-1])}</b> d'EBITDA`},
  {id:'rn', lab:"Résultat net", yr:true, get:R=>R.RN[NY-1], fmt:fEUR,
    tip:"Bénéfice final après charges financières et impôt.",
    sub:R=>{ const ca=R.CA[NY-1]||0; if(ca<=0) return '';
             return `<b>${fPCT(R.RN[NY-1]/ca)}</b> du CA`; }},
  {id:'tresoBas', lab:"Trésorerie — point bas", get:R=>Math.min(...R.tresoClot), fmt:fEUR,
    tip:"Le plus bas niveau de trésorerie sur tout l'horizon. S'il est négatif, il dimensionne le financement à sécuriser.",
    // l'année du point bas est l'information qui déclenche l'action — pas seulement son montant
    sub:R=>{ const i=lowIdx(R), neg=R.tresoClot.some(v=>v<0);
             return `atteint en <b>${ANNEES[i]}</b> · ${neg?'passe en négatif':'jamais négative'}`; }},
  {id:'levier', lab:"Dette nette / EBITDA", yr:true, get:R=>R.levier[NY-1], fmt:fX,
    tip:"Nombre d'années d'EBITDA nécessaires pour rembourser la dette nette. Seuil d'alerte bancaire ~3×.",
    sub:R=>`dette nette <b>${fEUR(R.detteNette[NY-1])}</b> · seuil 3×`},
  {id:'bfrJours', lab:"BFR (jours de CA)", yr:true, get:R=>R.bfrJours[NY-1], fmt:fJ,
    tip:"Besoin en Fonds de Roulement en jours de CA : le cash immobilisé par le cycle (créances + stocks − dettes fournisseurs).",
    sub:R=>`soit <b>${fEUR(bfrVal(R,NY-1))}</b> immobilisés`},
  {id:'roce', lab:"ROCE ap. impôt", yr:true, get:R=>R.ROCE[NY-1], fmt:fPCT,
    tip:"Return On Capital Employed : rentabilité des capitaux engagés, après impôt (NOPAT / (immos + BFR)). À comparer au WACC : ROCE > WACC = création de valeur.",
    sub:(R,H)=>`coût du capital <b>${fPCT((H.wacc||0))}</b>`},
  {id:'spread', lab:"ROCE − WACC", yr:true, get:(R,H)=>R.ROCE[NY-1]-((H.wacc||0)), fmt:fPCT,
    tip:"Écart entre la rentabilité des capitaux engagés et leur coût. Positif = création de valeur.",
    sub:(R,H)=>(R.ROCE[NY-1]-((H.wacc||0)))>=0 ? 'création de valeur' : '<b>destruction</b> de valeur'},
  {id:'fr', lab:"Fonds de roulement", yr:true, get:R=>frVal(R,NY-1), fmt:fEUR,
    tip:"Capitaux permanents − actif immobilisé : les ressources stables qui restent pour financer le cycle d'exploitation.",
    sub:R=>`BFR <b>${fEUR(bfrVal(R,NY-1))}</b>`},
  {id:'bfrEur', lab:"BFR (en valeur)", yr:true, get:R=>bfrVal(R,NY-1), fmt:fEUR,
    tip:"Stocks + créances clients − dettes fournisseurs : le cash gelé par le cycle d'exploitation.",
    sub:R=>`<b>${fJ(R.bfrJours[NY-1])}</b> de chiffre d'affaires`},
  {id:'fcf', lab:"Free cash flow", yr:true, get:R=>R.FCF[NY-1], fmt:fEUR,
    tip:"Flux d'exploitation − investissements : le cash réellement disponible avant financement.",
    sub:R=>`cumulé <b>${fEUR(R.FCF.reduce((a,b)=>a+b,0))}</b> sur ${NY} ans`},
  {id:'margeSecu', lab:"Marge de sécurité", yr:true, get:R=>R.margeSecu[NY-1], fmt:fPCT,
    tip:"Part du chiffre d'affaires qui peut disparaître avant d'atteindre le point mort.",
    sub:R=>`point mort <b>${fEUR(R.pointMort[NY-1])}</b>`},
  {id:'bilan', lab:"Équilibre du bilan", get:R=>R.ctrl.every(x=>Math.abs(x)<1)?1:0,
    fmt:v=>`<span class="badge ${v?'ok':'ko'}">${v?'✓ équilibré':'✗ écart'}</span>`,
    tip:"Contrôle Actif − Passif sur toutes les années. Un écart signale une incohérence de modélisation.",
    sub:()=>`Actif − Passif sur ${NY} ans`},
];
const KPI_BY_ID = {}; KPI_DEFS.forEach(k=>KPI_BY_ID[k.id]=k);
// Sens de lecture : true = « plus c'est haut, mieux c'est ». Sert à surligner la
// meilleure valeur dans la comparaison de scénarios.
const KPI_HIGOOD = {ca:true, margeEBITDA:true, rn:true, tresoBas:true, roce:true, spread:true,
                    fr:true, fcf:true, margeSecu:true, bilan:true,
                    levier:false, bfrJours:false, bfrEur:false};
const KPI_PINS_DEF = ['ca','margeEBITDA','rn','tresoBas'];
const KPI_MAX_PINS = 4;
let kpiPins = KPI_PINS_DEF.slice();

// Un scénario enregistré AVANT cette version n'a pas le champ : on retombe sur le défaut,
// sinon la vue d'ensemble s'affiche sans aucun KPI, et sans erreur en console.
function pinsFromState(s){
  const p = s && Array.isArray(s.kpiPins) ? s.kpiPins.filter(id=>KPI_BY_ID[id]) : [];
  return p.length ? p.slice(0,KPI_MAX_PINS) : KPI_PINS_DEF.slice();
}

function kpiCardHTML(k,R,H){
  const lab = k.yr ? `${k.lab} · ${ANNEES[NY-1]}` : k.lab;
  const sub = k.sub ? k.sub(R,H) : '';
  return `<div class="kpi">
    <div class="k-lab">${lab}${k.tip?tipHTML(k.tip):''}</div>
    <div class="k-val">${k.fmt(k.get(R,H))}</div>
    ${sub?`<div class="k-sub">${sub}</div>`:''}</div>`;
}
function renderKPIs(R,H){
  const pinned = kpiPins.map(id=>KPI_BY_ID[id]).filter(Boolean);
  const rest   = KPI_DEFS.filter(k=>kpiPins.indexOf(k.id)<0);
  document.getElementById('kpis').innerHTML = pinned.map(k=>kpiCardHTML(k,R,H)).join('');
  document.getElementById('kpisMore').innerHTML = rest.map(k=>{
    const lab = k.yr ? `${k.lab} · ${ANNEES[NY-1]}` : k.lab;
    return `<div><div class="k-lab">${lab}</div><div class="k-val">${k.fmt(k.get(R,H))}</div></div>`;
  }).join('');
}

// ============================================================
//  CONSEILLER CFO — moteur de règles : diagnostic → constat chiffré → levier
// ============================================================
// ---- Modale « Choisir les KPI » : 4 au maximum en tête de la vue d'ensemble ----
function buildPinModal(){
  const m=document.createElement('div'); m.className='modal-overlay'; m.id='pinModal';
  m.innerHTML=`<div class="modal">
    <div class="modal-head"><h2>Choisir les KPI mis en avant</h2>
      <button type="button" class="modal-close" id="pinClose">✕</button></div>
    <p class="modal-sub">Les <b>${KPI_MAX_PINS}</b> indicateurs cochés s'affichent en grand format.
      Les autres restent lisibles dans la bande compacte, juste en dessous. Le choix est enregistré
      avec le scénario.</p>
    <div class="pin-grid" id="pinGrid"></div>
    <div class="modal-foot"><span id="pinCount"></span>
      <button type="button" class="btn-primary" id="pinDone">Terminé</button></div>
  </div>`;
  document.body.appendChild(m);
  const grid=document.getElementById('pinGrid');
  const render=()=>{
    const full = kpiPins.length>=KPI_MAX_PINS;
    grid.innerHTML = KPI_DEFS.map(k=>{
      const on = kpiPins.indexOf(k.id)>=0;
      return `<label class="pin-row ${on?'on':''} ${full&&!on?'full':''}">
        <input type="checkbox" data-id="${k.id}" ${on?'checked':''} ${full&&!on?'disabled':''}>
        <span>${k.lab}</span></label>`;
    }).join('');
    document.getElementById('pinCount').textContent =
      `${kpiPins.length} / ${KPI_MAX_PINS} sélectionné${kpiPins.length>1?'s':''}`;
  };
  grid.addEventListener('change',e=>{
    const cb=e.target.closest('input[type=checkbox]'); if(!cb) return;
    const id=cb.dataset.id, i=kpiPins.indexOf(id);
    if(cb.checked){ if(i<0 && kpiPins.length<KPI_MAX_PINS) kpiPins.push(id); }
    else if(i>=0) kpiPins.splice(i,1);
    render(); refresh();
  });
  const close=()=>m.classList.remove('open');
  document.getElementById('pinClose').addEventListener('click',close);
  document.getElementById('pinDone').addEventListener('click',close);
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  document.getElementById('btnPins').addEventListener('click',()=>{ render(); m.classList.add('open'); });
}

// ---- Carte « Structure financière » : l'équilibre FR / BFR / trésorerie, puis les ratios ----
// FR − BFR = trésorerie nette. C'est la base de l'analyse financière, et le moteur ne
// produisait ni le FR ni le BFR en valeur : les deux sont dérivés du bilan.
function renderStructure(R,H){
  const t=NY-1;
  const fr=frVal(R,t), bfr=bfrVal(R,t), tn=R.tresoClot[t];
  const ech=Math.max(Math.abs(fr),Math.abs(bfr),Math.abs(tn),1);
  const pc=v=>Math.min(100, Math.abs(v)/ech*100).toFixed(1);
  const st=(good)=>good?'ok':'warn';
  const bar=(lab,val,fmt,color,cls)=>`<div class="tline">
      <span>${lab}</span><span class="${cls||''}">${fmt(val)}</span>
      <div class="track"><i class="${color}" style="width:${pc(val)}%"></i></div></div>`;

  // seuils : lecture bancaire usuelle
  const lev=R.levier[t], jours=R.bfrJours[t], secu=R.margeSecu[t];
  const rt=(lab,val,fmt,good,ratio)=>`<div class="tline">
      <span>${lab}</span><span class="${st(good)}">${fmt(val)}</span>
      <div class="track"><i class="${st(good)}" style="width:${Math.min(100,Math.max(0,ratio*100)).toFixed(1)}%"></i></div></div>`;

  document.getElementById('structSub').textContent = 'position en '+ANNEES[t];
  document.getElementById('structBody').innerHTML =
    `<p class="tline-h">Équilibre financier — en valeur</p>`
    + bar('Fonds de roulement', fr, fEUR, 'neutral', fr>=0?'ok':'bad')
    + bar('− Besoin en FR',     bfr, fEUR, 'warn', '')
    + bar('= Trésorerie nette', tn, fEUR, tn>=0?'ok':'bad', tn>=0?'ok':'bad')
    + `<p class="tline-eq">${
        fr>=bfr
          ? "FR &gt; BFR : le cycle d'exploitation est financé par des ressources stables, l'excédent alimente la trésorerie."
          : "FR &lt; BFR : le cycle d'exploitation n'est pas couvert par les ressources stables — la trésorerie comble l'écart."
      }</p>`
    + `<p class="tline-h mt">Ratios — face à leur seuil</p>`
    + rt('Dette nette / EBITDA', lev,   fX,   !(lev>3),      isFinite(lev)?lev/6:0)
    + rt('BFR (jours de CA)',    jours, fJ,   jours<=60,     jours/120)
    + rt('Marge de sécurité',    secu,  fPCT, secu>=0.20,    secu)
    + rt('ROCE − WACC',          R.ROCE[t]-((H.wacc||0)), fPCT,
         R.ROCE[t]>=(H.wacc||0), Math.abs(R.ROCE[t]-((H.wacc||0)))/0.20);
}

// ---- Bandeau collant : les sorties clés restent lisibles pendant qu'on règle ----
function renderStickybar(R){
  const t=NY-1, bas=Math.min(...R.tresoClot), bilanOK=R.ctrl.every(x=>Math.abs(x)<1);
  const it=(lab,val,cls)=>`<div class="sb-item"><span>${lab}</span><b class="${cls||''}">${val}</b></div>`;
  document.getElementById('stickybar').innerHTML =
      it('CA '+ANNEES[t], fEUR(R.CA[t]))
    + it('EBITDA', fPCT(R.margeEBITDA[t]))
    + it('Résultat net', fEUR(R.RN[t]), cls(R.RN[t]))
    + it('Tréso point bas', fEUR(bas), cls(bas))
    + it('Bilan', bilanOK?'✓ équilibré':'✗ écart', bilanOK?'pos':'neg')
    + `<div class="sb-right"><span class="sb-dot"></span>recalcul instantané</div>`;
}

function diagnose(R,H){
  const F=[], last=NY-1;
  const pointBas=Math.min(...R.tresoClot);
  const yBas=ANNEES[R.tresoClot.indexOf(pointBas)];

  // 1. Trou de trésorerie
  if(pointBas<0){
    const besoin=Math.ceil(-pointBas/10000)*10000;
    F.push({level:'critical',titre:'Trou de trésorerie',
      constat:`La trésorerie plonge à <b>${fEUR(pointBas)}</b> en ${yBas}. Sans financement, l'entreprise est en cessation de paiement.`,
      levier:`Sécuriser une ligne de crédit d'au moins <b>${fEUR(besoin)}</b> avant ${yBas}. Autres leviers : étaler le CAPEX, ou réduire le DSO — chaque 10 jours de délai clients en moins libère ~${fEUR(R.CA[last]*10/365)} de cash.`});
  }

  // 1bis. Capitaux propres négatifs — souvent provoqué par un rachat de parts trop lourd,
  // ou par des pertes cumulées. Signal juridique fort, distinct du trou de trésorerie.
  const cp=R.cpClot||[];
  const cpNeg=cp.findIndex(x=>x<0);
  if(cpNeg>=0){
    F.push({level:'critical',titre:'Capitaux propres négatifs',
      constat:`Les capitaux propres deviennent négatifs en ${ANNEES[cpNeg]} (<b>${fEUR(cp[cpNeg])}</b>). L'entreprise doit plus qu'elle ne possède : en France, les associés doivent alors se prononcer sur la poursuite de l'activité.`,
      levier:`Réduire ou décaler le rachat de parts et les dividendes, ou reconstituer les fonds propres par une ouverture de capital. Un prêteur refusera de financer une structure aux capitaux propres négatifs.`});
  }

  // 2. Endettement élevé
  const finLev=R.levier.filter(x=>isFinite(x));
  const levMax=finLev.length?Math.max(...finLev):NaN;
  if(isFinite(levMax) && levMax>3){
    const yl=ANNEES[R.levier.indexOf(levMax)];
    F.push({level:'warning',titre:'Endettement élevé',
      constat:`Le ratio dette nette/EBITDA atteint <b>${fX(levMax)}</b> en ${yl} — au-dessus du seuil d'alerte bancaire de 3×. Un prêteur hésitera à financer davantage.`,
      levier:`Renforcer le remboursement (échéancier de financement) ou faire progresser l'EBITDA. Éviter de financer la croissance uniquement par la dette.`});
  }

  // 3. Années déficitaires
  const pertes=R.RN.map((v,i)=>v<0?i:-1).filter(i=>i>=0);
  if(pertes.length){
    F.push({level:'serious',titre:'Années déficitaires',
      constat:`Résultat net négatif en ${pertes.map(i=>ANNEES[i]).join(', ')} (au plus bas : <b>${fEUR(Math.min(...R.RN))}</b>).`,
      levier:`Revenir vers le point mort : agir sur les prix, le taux de charges variables ou les charges fixes.`});
  }

  // 4. Dividendes à crédit
  const badDiv=R.div.map((v,i)=>(v>0 && R.tresoClot[i]<0)?i:-1).filter(i=>i>=0);
  if(badDiv.length){
    F.push({level:'warning',titre:'Dividendes à crédit',
      constat:`Des dividendes sont versés (${fEUR(R.div[badDiv[0]])} en ${ANNEES[badDiv[0]]}) alors que la trésorerie est négative : distribution de cash non disponible.`,
      levier:`Suspendre ou réduire le dividende (taux de dividende) tant que la trésorerie n'est pas rétablie.`});
  }

  // 5. ROCE (après impôt) < coût du capital (WACC)
  const roce=R.ROCE[last];
  if(isFinite(roce) && roce<H.wacc){
    F.push({level:'serious',titre:'Rentabilité sous le coût du capital',
      constat:`Le ROCE après impôt (<b>${fPCT(roce)}</b>) est sous le coût du capital / WACC (${fPCT(H.wacc)}) : chaque euro engagé rapporte moins qu'il ne coûte à financer — <b>destruction de valeur</b> (ROCE &lt; WACC).`,
      levier:`Améliorer la marge d'exploitation ou alléger les capitaux engagés (CAPEX, BFR) avant d'investir davantage.`});
  }

  // 6. Marge de sécurité faible (N+4)
  const ms=R.margeSecu[last];
  if(isFinite(ms) && ms<0.10){
    F.push({level: ms<0?'critical':'warning',titre:'Faible marge de sécurité',
      constat:`En ${ANNEES[last]}, la marge de sécurité n'est que de <b>${fPCT(ms)}</b> : une baisse de CA de ${fPCT(Math.max(0,ms))} suffirait à repasser sous le point mort.`,
      levier:`S'éloigner du point mort : hausse de prix, baisse du taux de charges variables, ou volume additionnel.`});
  }

  // 7. BFR qui immobilise du cash (N+4)
  const bfrj=R.bfrJours[last];
  if(isFinite(bfrj) && bfrj>60){
    F.push({level:'warning',titre:'BFR qui gèle du cash',
      constat:`Le BFR pèse <b>${fJ(bfrj)}</b> de CA en ${ANNEES[last]} (${fEUR(R.BFR[last])}) — du cash immobilisé dans le cycle d'exploitation.`,
      levier:`Négocier des délais fournisseurs plus longs (DPO, actuel ${H.DPO} j), réduire les délais clients (DSO ${H.DSO} j) et le stock (DIO ${H.DIO} j).`});
  }

  // 8. Marge d'EBITDA en érosion
  if(isFinite(R.margeEBITDA[0]) && R.margeEBITDA[last] < R.margeEBITDA[0]-0.02){
    F.push({level:'info',titre:`Marge d'EBITDA en érosion`,
      constat:`La marge d'EBITDA recule de ${fPCT(R.margeEBITDA[0])} à <b>${fPCT(R.margeEBITDA[last])}</b> sur l'horizon : la profitabilité se dégrade.`,
      levier:`Surveiller l'inflation des charges fixes et de personnel face à la croissance du CA.`});
  }

  // Rien à signaler → message positif
  if(!F.length){
    F.push({level:'good',titre:'Situation financière saine',
      constat:`Trésorerie positive sur tout l'horizon, levier maîtrisé (&lt;3×), ROCE au-dessus du coût du capital. Bon profil.`,
      levier:`Possibilité d'accélérer (investissement, nouvelle gamme) : en tester l'impact via les décisions.`});
  }
  return F;
}
function renderConseiller(R,H){
  const order={critical:0,serious:1,warning:2,info:3,good:4};
  const sev={critical:'Critique',serious:'Sérieux',warning:'Vigilance',info:'Information',good:'Sain'};
  const F=diagnose(R,H).sort((a,b)=>order[a.level]-order[b.level]);
  const html=`<div class="conseil-h">Conseiller CFO<span class="conseil-count">${F.length} point${F.length>1?'s':''}</span></div>`
    + F.map(f=>`<div class="finding ${f.level}">
        <div class="f-titre"><span class="f-sev">${sev[f.level]}</span>${f.titre}</div>
        <div class="f-constat">${f.constat}</div>
        <div class="f-levier"><b>Levier :</b> ${f.levier}</div>
      </div>`).join('');
  document.getElementById('conseil').innerHTML=html;
}

// Les 5 blocs du pack. `id` sert au repli et aux pastilles de saut, `court` à ces dernières.
const PACK_SECTIONS = [
  {id:'cr',     lab:'COMPTE DE RÉSULTAT',            court:'Compte de résultat'},
  {id:'flux',   lab:'TABLEAU DE FLUX DE TRÉSORERIE', court:'Flux de trésorerie'},
  {id:'actif',  lab:'BILAN — ACTIF',                 court:'Bilan actif'},
  {id:'passif', lab:'BILAN — PASSIF',                court:'Bilan passif'},
  {id:'indic',  lab:'INDICATEURS',                   court:'Indicateurs'},
];

function renderTable(R){
  const head=`<tr><th>(en €)</th>${ANNEES.map(a=>`<th>${a}</th>`).join('')}</tr>`;
  let curSec='';   // section courante : chaque ligne la porte, pour pouvoir la replier
  const line=(lab,arr,fmt=fEUR,color=false,sec=false,tot=false)=>{
    const tds=arr.map(v=>{
      const c = color? cls(v):'';
      return `<td class="${c}">${fmt(v)}</td>`;
    }).join('');
    return `<tr class="${sec?'sec':''} ${tot?'tot':''}" data-sec="${curSec}"><td>${lab}</td>${tds}</tr>`;
  };
  // bandeau de section : cliquable, il replie les lignes qui le suivent
  const sect=(id)=>{
    curSec=id;
    const s=PACK_SECTIONS.find(x=>x.id===id);
    return `<tr class="grouprow" data-sec="${id}" title="Replier ou déplier cette section">`
         + `<td colspan="${NY+1}">${s?s.lab:id}</td></tr>`;
  };
  const cession = R.resExcept.some(x=>Math.abs(x)>0.5);
  let h=head;

  h+=sect("cr");
  h+=line("Chiffre d'affaires",R.CA,fEUR,false,false,true);
  h+=line("Croissance du CA",R.croiss,fPCT);
  h+=line("Charges variables",R.chgv.map(x=>-x));
  h+=line("Marge sur coûts variables",R.marge);
  h+=line("Charges fixes",R.cf.map(x=>-x));
  h+=line("Charges de personnel",R.perso.map(x=>-x));
  h+=line("EBITDA",R.EBITDA,fEUR,true,false,true);
  h+=line("Marge d'EBITDA",R.margeEBITDA,fPCT);
  h+=line("Dotation aux amortissements",R.dot.map(x=>-x));
  h+=line("EBIT",R.EBIT,fEUR,true,false,true);
  h+=line("Charges financières",R.chgfin.map(x=>-x));
  if(cession) h+=line("Résultat de cession",R.resExcept,fEUR,true);
  h+=line("Résultat avant impôt",R.RAI,fEUR,true);
  h+=line("Impôt sur les sociétés",R.IS.map(x=>-x));
  h+=line("RÉSULTAT NET",R.RN,fEUR,true,false,true);

  // Méthode indirecte : on repart du résultat net, on annule les charges non décaissées
  // (dotations) et on corrige de la variation du besoin en fonds de roulement.
  h+=sect("flux");
  h+=line("Résultat net",R.RN,fEUR,true);
  h+=line("+ Dotation aux amortissements",R.dot);
  h+=line("− Variation du BFR",R.varBFR.map(x=>-x),fEUR,true);
  if(cession) h+=line("− Résultat de cession",R.resExcept.map(x=>-x),fEUR,true);
  h+=line("Flux de trésorerie d'exploitation",R.fExpl,fEUR,true,false,true);
  h+=line("− Investissements (CAPEX)",R.capex.map(x=>-x));
  if(R.cessions.some(x=>Math.abs(x)>0.5)) h+=line("+ Produits de cession",R.cessions);
  h+=line("Flux d'investissement",R.fInv,fEUR,true,false,true);
  h+=line("FREE CASH FLOW",R.FCF,fEUR,true,false,true);
  h+=line("Flux de financement",R.fFin,fEUR,true,false,true);
  h+=line("Variation de trésorerie",R.varTreso,fEUR,true);
  h+=line("Trésorerie d'ouverture",R.tresoOuv,fEUR,true);
  h+=line("Trésorerie de clôture",R.tresoClot,fEUR,true,false,true);

  h+=sect("actif");
  h+=line("Immobilisations nettes",R.immoClot);
  h+=line("Stocks",R.stocks);
  h+=line("Créances clients",R.creances);
  h+=line("Trésorerie",R.tresoClot,fEUR,true);
  h+=line("TOTAL ACTIF",R.actif,fEUR,false,false,true);

  h+=sect("passif");
  h+=line("Capitaux propres",R.cpClot,fEUR,true);
  h+=line("Dettes financières",R.detteClot);
  h+=line("Dettes fournisseurs",R.df);
  h+=line("TOTAL PASSIF",R.passif,fEUR,false,false,true);
  h+=line("Contrôle Actif − Passif",R.ctrl,fEUR,false,false,true);

  h+=sect("indic");
  h+=line("BFR (jours de CA)",R.bfrJours,fJ);
  h+=line("Dette nette",R.detteNette);
  h+=line("Dette nette / EBITDA",R.levier,fX,false);
  h+=line("ROCE (après impôt)",R.ROCE,fPCT,false);
  h+=line("Point mort (CA)",R.pointMort,fEUR,false);
  h+=line("Marge de sécurité",R.margeSecu,fPCT);
  document.getElementById('tbl').innerHTML=h;
  applySections();   // restitue les sections repliées, que le rendu vient d'effacer
  const ps=document.getElementById('packSub');
  if(ps) ps.textContent = `${ANNEES[0]} → ${ANNEES[NY-1]} · ${PACK_SECTIONS.length} sections`;
}

// ---- Vue d'ensemble : le compte de résultat en 6 lignes ----
// Le détail vit dans l'onglet « Pack financier ». Ici on garde la substance : du CA
// au résultat net, plus la trésorerie, sans les 46 lignes.
function renderMiniTable(R){
  const el=document.getElementById('tblMini'); if(!el) return;
  const line=(lab,arr,fmt=fEUR,color=false,tot=false)=>
    `<tr class="${tot?'tot':''}"><td>${lab}</td>`
    + arr.map(v=>`<td class="${color?cls(v):''}">${fmt(v)}</td>`).join('') + `</tr>`;
  el.innerHTML =
      `<tr><th>(en €)</th>${ANNEES.map(a=>`<th>${a}</th>`).join('')}</tr>`
    + line("Chiffre d'affaires",R.CA,fEUR,false,true)
    + line("Marge sur coûts variables",R.marge)
    + line("EBITDA",R.EBITDA,fEUR,true,true)
    + line("EBIT",R.EBIT,fEUR,true)
    + line("RÉSULTAT NET",R.RN,fEUR,true,true)
    + line("Trésorerie de clôture",R.tresoClot,fEUR,true,true);
}

// ---- Repli des sections + pastilles de saut (onglet Pack financier) ----
// `packClosed` survit au rendu : renderTable réécrit le tableau à CHAQUE frappe, une
// section repliée se rouvrirait sinon aussitôt.
let packClosed={};
function setSection(id,closed){
  packClosed[id]=closed;
  const tbl=document.getElementById('tbl'); if(!tbl) return;
  const band=tbl.querySelector('tr.grouprow[data-sec="'+id+'"]');
  if(band) band.classList.toggle('closed',closed);
  tbl.querySelectorAll('tr[data-sec="'+id+'"]:not(.grouprow)')
     .forEach(tr=>tr.classList.toggle('row-off',closed));
}
function applySections(){ PACK_SECTIONS.forEach(s=>setSection(s.id, !!packClosed[s.id])); }
function sectionClosed(id){ return !!packClosed[id]; }
function buildPackNav(){
  const wrap=document.getElementById('packJump'); if(!wrap) return;
  wrap.innerHTML = PACK_SECTIONS.map(s=>
    `<button type="button" class="chip" data-jump="${s.id}">${s.court}</button>`).join('');
  wrap.addEventListener('click',e=>{
    const b=e.target.closest('[data-jump]'); if(!b) return;
    const id=b.dataset.jump;
    if(sectionClosed(id)) setSection(id,false);            // une section repliée se rouvre avant le saut
    const band=document.querySelector('#tbl tr.grouprow[data-sec="'+id+'"]');
    if(band) band.scrollIntoView({block:'start',behavior:'smooth'});
  });
  // clic sur un bandeau = repli de sa section
  document.getElementById('tbl').addEventListener('click',e=>{
    const band=e.target.closest('tr.grouprow'); if(!band) return;
    setSection(band.dataset.sec, !band.classList.contains('closed'));
  });
  document.getElementById('btnPackAll').addEventListener('click',function(){
    const fermer = this.textContent.indexOf('replier')>=0;
    PACK_SECTIONS.forEach(s=>setSection(s.id,fermer));
    this.textContent = fermer ? 'Tout déplier' : 'Tout replier';
  });
}

function mkChart(id,cfg){ if(charts[id])charts[id].destroy(); charts[id]=new Chart(document.getElementById(id),cfg); }
// Palette validée (dataviz) : catégorielle bleu/aqua/jaune + statuts vert/rouge
const C={blue:'#2a78d6',aqua:'#1baf7a',yellow:'#eda100',good:'#0ca30c',critical:'#d03b3b',warning:'#fab219',
         blueLight:'#a9c7ef',aquaLight:'#8fd8bd',baseGray:'#cdccc4',
         ink2:'#52514e',muted:'#898781',grid:'#e1e0d9',axis:'#c3c2b7'};
const BAR={borderRadius:4,borderSkipped:false,maxBarThickness:30};
const GRID={color:C.grid}, TICK={color:C.muted,font:{size:10}};
const axes={x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:{...TICK,callback:v=>(v/1000)+'k'}}};
const LEG=(show=true)=>({display:show,labels:{color:C.ink2,boxWidth:10,boxHeight:10,usePointStyle:true,font:{size:11}}});

function renderCharts(R){
  mkChart('cActivite',{type:'bar',data:{labels:ANNEES,datasets:[
      {label:'CA',data:R.CA,backgroundColor:C.blue,...BAR},
      {label:'EBITDA',data:R.EBITDA,backgroundColor:C.aqua,...BAR}
    ]},
    options:{responsive:true,plugins:{legend:LEG()},scales:axes}});

  // Le remplissage bascule au passage du zéro : un trou de trésorerie se voit d'un coup d'œil,
  // sans avoir à lire l'axe.
  mkChart('cTreso',{type:'line',data:{labels:ANNEES,datasets:[
      {label:'Trésorerie',data:R.tresoClot,borderColor:C.blue,borderWidth:2,
       fill:{target:{value:0}, above:'rgba(42,120,214,.10)', below:'rgba(208,59,59,.20)'},
       tension:.3,pointRadius:4,pointHoverRadius:6,
       pointBackgroundColor:R.tresoClot.map(v=>v<0?C.critical:C.good),
       pointBorderColor:R.tresoClot.map(v=>v<0?C.critical:C.good)},
      {label:'Zéro',data:ANNEES.map(()=>0),borderColor:C.axis,borderWidth:1,pointRadius:0,fill:false}
    ]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:axes}});

  mkChart('cRN',{type:'bar',data:{labels:ANNEES,datasets:[
      {label:'Résultat net',data:R.RN,...BAR,backgroundColor:R.RN.map(v=>v<0?C.critical:C.good)}
    ]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:axes}});

  mkChart('cLevier',{type:'line',data:{labels:ANNEES,datasets:[
      {label:'Dette nette/EBITDA',data:R.levier,borderColor:C.yellow,backgroundColor:C.yellow,
       borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.3},
      {label:'Seuil 3×',data:ANNEES.map(()=>3),borderColor:C.critical,borderDash:[6,4],borderWidth:1.5,pointRadius:0}
    ]},
    options:{responsive:true,plugins:{legend:LEG()},
      scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:{...TICK,callback:v=>v+'×'}}}}});
}

// ============================================================
//  SECTION FINANCEMENT — 3 graphes + tableau d'amortissement consolidé
// ============================================================
function finLabels(H){ return Array.from({length:H},(_,i)=> i<NY?ANNEES[i]:'N+'+i); }
function renderFinance(R){   // partie DOM (sûre même onglet masqué) : sous-titre + tableau
  const fin=R.fin, H=fin.horizon, labels=finLabels(H);
  const noDette = fin.detteClot.every(v=>Math.abs(v)<1) && fin.interet.every(v=>Math.abs(v)<1);
  document.getElementById('finSecSub').textContent =
    noDette ? '· aucun emprunt' : `· ${fin.loans.length} emprunt${fin.loans.length>1?'s':''} sur ${H} ans`;
  const row=(lab,arr,tot=false)=>`<tr class="${tot?'tot':''}"><td>${lab}</td>${arr.map(v=>`<td>${fEUR(v)}</td>`).join('')}</tr>`;
  let h=`<tr><th>(en €)</th>${labels.map(a=>`<th>${a}</th>`).join('')}</tr>`;
  h+=row('Intérêts',fin.interet);
  h+=row('Remboursement du capital',fin.capital);
  h+=row('Annuité totale',fin.interet.map((v,i)=>v+fin.capital[i]),true);
  h+=row('Capital restant dû',fin.detteClot,true);
  document.getElementById('finTbl').innerHTML=h;
}
function renderFinanceCharts(R){   // graphes (uniquement quand l'onglet Simulation est visible)
  const fin=R.fin, H=fin.horizon, labels=finLabels(H);
  const kEUR={...TICK,callback:v=>(v/1000)+'k'};
  mkChart('cResteDu',{type:'line',data:{labels,datasets:[
      {label:'Capital restant dû',data:fin.detteClot,borderColor:C.blue,backgroundColor:'rgba(42,120,214,.10)',
       fill:true,borderWidth:2,pointRadius:2,pointHoverRadius:5,tension:.2}]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:kEUR,beginAtZero:true}}}});

  mkChart('cInterets',{type:'bar',data:{labels,datasets:[
      {label:'Intérêts',data:fin.interet,backgroundColor:C.critical,...BAR}]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:kEUR,beginAtZero:true}}}});

  mkChart('cCapital',{type:'bar',data:{labels,datasets:[
      {label:'Remboursement du capital',data:fin.capital,backgroundColor:C.aqua,...BAR}]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:kEUR,beginAtZero:true}}}});
}

// ============================================================
//  ANALYSE PAR RÉFÉRENCE — CA / mix / marge par produit
// ============================================================
const REF_PAL=['#2a78d6','#1baf7a','#eda100','#4a3aa7','#eb6834','#e34948','#0ca30c','#8a6d3b','#7a5cff','#d03b3b'];
function renderRefsAnalysis(R){   // partie DOM (sûre même onglet masqué) : KPIs + tableau
  const S=R.refSeries||[]; const last=NY-1;
  const sub=document.getElementById('refAnSub'); if(sub) sub.textContent=`· ${S.length} référence${S.length>1?'s':''} · ${ANNEES[last]}`;
  // KPIs : la référence n°1 en CA, sa marge, le poids du mix de tête, croissance CA de tête
  const kp=document.getElementById('refKpis');
  if(kp){
    if(!S.length){ kp.innerHTML='<div class="kpi"><div class="k-lab">Références</div><div class="k-val">—</div><div class="k-sub">Ajoute une référence</div></div>'; }
    else {
      const caLast=S.map(s=>s.ca[last]); const totLast=caLast.reduce((a,b)=>a+b,0)||1;
      const iTop=caLast.indexOf(Math.max(...caLast)); const top=S[iTop];
      const txTop = top.ca[last]? top.marge[last]/top.ca[last]*100 : 0;
      const best = S.reduce((a,s)=>{ const t=s.ca[last]?s.marge[last]/s.ca[last]*100:-1; return t>a.t?{nom:s.nom,t}:a; },{nom:'—',t:-1});
      kp.innerHTML=[
        {l:`Référence n°1 (${ANNEES[last]})`, v:esc(top.nom), s:`${fEUR(top.ca[last])} de CA`},
        {l:'Poids dans le mix', v:(top.ca[last]/totLast*100).toFixed(0)+' %', s:`part de « ${esc(top.nom)} »`},
        {l:'Taux de marge n°1', v:txTop.toFixed(0)+' %', s:'marge sur coûts variables'},
        {l:'Meilleur taux de marge', v:best.t>=0?best.t.toFixed(0)+' %':'—', s:esc(best.nom)},
      ].map(k=>`<div class="kpi"><div class="k-lab">${k.l}</div><div class="k-val">${k.v}</div><div class="k-sub">${k.s}</div></div>`).join('');
    }
  }
  // tableau : CA par ref + total, marge par ref, taux de marge
  const tbl=document.getElementById('refTbl'); if(tbl){
    const head=`<tr><th>(en €)</th>${ANNEES.map(a=>`<th>${a}</th>`).join('')}</tr>`;
    const line=(lab,arr,fmt=fEUR,tot=false)=>`<tr class="${tot?'tot':''}"><td>${lab}</td>${arr.map(v=>`<td>${fmt(v)}</td>`).join('')}</tr>`;
    let h=head+`<tr class="sec"><td colspan="${NY+1}">Chiffre d'affaires par référence</td></tr>`;
    S.forEach(s=>h+=line(esc(s.nom), s.ca));
    h+=line("CA total", ANNEES.map((_,t)=>S.reduce((a,s)=>a+s.ca[t],0)), fEUR, true);
    h+=`<tr class="sec"><td colspan="${NY+1}">Marge sur coûts variables par référence</td></tr>`;
    S.forEach(s=>h+=line(esc(s.nom), s.marge));
    h+=line("Marge totale", ANNEES.map((_,t)=>S.reduce((a,s)=>a+s.marge[t],0)), fEUR, true);
    h+=`<tr class="sec"><td colspan="${NY+1}">Taux de marge par référence</td></tr>`;
    S.forEach(s=>h+=line(esc(s.nom), s.ca.map((c,t)=>c?s.marge[t]/c:NaN), fPCT));
    tbl.innerHTML=h;
  }
}
function renderRefsCharts(R){
  const S=R.refSeries||[]; const kEUR={...TICK,callback:v=>(v/1000)+'k'};
  const color=i=>REF_PAL[i%REF_PAL.length];
  // CA par référence (barres empilées)
  mkChart('cRefCA',{type:'bar',data:{labels:ANNEES,datasets:S.map((s,i)=>({label:s.nom,data:s.ca,backgroundColor:color(i),stack:'ca',...BAR}))},
    options:{responsive:true,plugins:{legend:LEG(S.length>1)},scales:{x:{stacked:true,grid:{display:false},ticks:TICK},y:{stacked:true,grid:GRID,ticks:kEUR,beginAtZero:true}}}});
  // Mix : poids dans le CA en % (empilé à 100 %)
  const tot=ANNEES.map((_,t)=>S.reduce((a,s)=>a+s.ca[t],0));
  mkChart('cRefMix',{type:'bar',data:{labels:ANNEES,datasets:S.map((s,i)=>({label:s.nom,data:s.ca.map((c,t)=>tot[t]?c/tot[t]*100:0),backgroundColor:color(i),stack:'mix',...BAR}))},
    options:{responsive:true,plugins:{legend:LEG(S.length>1)},scales:{x:{stacked:true,grid:{display:false},ticks:TICK},y:{stacked:true,grid:GRID,ticks:{...TICK,callback:v=>v+'%'},min:0,max:100}}}});
  // Marge par référence (barres empilées)
  mkChart('cRefMarge',{type:'bar',data:{labels:ANNEES,datasets:S.map((s,i)=>({label:s.nom,data:s.marge,backgroundColor:color(i),stack:'m',...BAR}))},
    options:{responsive:true,plugins:{legend:LEG(S.length>1)},scales:{x:{stacked:true,grid:{display:false},ticks:TICK},y:{stacked:true,grid:GRID,ticks:kEUR,beginAtZero:true}}}});
  // Taux de marge par référence (lignes)
  mkChart('cRefTx',{type:'line',data:{labels:ANNEES,datasets:S.map((s,i)=>({label:s.nom,data:s.ca.map((c,t)=>c?s.marge[t]/c*100:null),borderColor:color(i),backgroundColor:color(i),borderWidth:2,pointRadius:2,tension:.3}))},
    options:{responsive:true,plugins:{legend:LEG(S.length>1)},scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:{...TICK,callback:v=>v+'%'}}}}});
}

// ============================================================
//  VALORISATION DCF — FCFF actualisés + valeur terminale
// ============================================================
function dcfEV(R,H,w,g){                              // EV via Gordon pour un couple (WACC,g) donné — sert aussi à la sensibilité
  const N=NY, ovT=H.ov&&H.ov.tauxIS; let sumPV=0, fcffLast=0;
  for(let t=0;t<N;t++){
    const tax=ovT?ovT[t]:H.tauxIS;
    const fcff=R.EBIT[t]*(1-tax)+R.dot[t]-R.capex[t]-R.varBFR[t];
    sumPV += fcff/Math.pow(1+w,t+1);
    if(t===N-1) fcffLast=fcff;
  }
  const TV = w>g ? fcffLast*(1+g)/(w-g) : NaN;
  const pvTV = isFinite(TV) ? TV/Math.pow(1+w,N) : NaN;
  return isFinite(pvTV) ? sumPV+pvTV : NaN;
}
function computeDCF(R,H){
  const N=NY, w=H.wacc, g=H.dcfG, ovT=H.ov&&H.ov.tauxIS;
  const NOPAT=[],addDA=[],capex=[],dBFR=[],FCFF=[],disc=[],PV=[];
  for(let t=0;t<N;t++){
    const tax=ovT?ovT[t]:H.tauxIS;
    NOPAT[t]=R.EBIT[t]*(1-tax);
    addDA[t]=R.dot[t]; capex[t]=R.capex[t]; dBFR[t]=R.varBFR[t];
    FCFF[t]=NOPAT[t]+addDA[t]-capex[t]-dBFR[t];
    disc[t]=1/Math.pow(1+w,t+1);
    PV[t]=FCFF[t]*disc[t];
  }
  const sumPV=PV.reduce((a,b)=>a+b,0);
  const TVg = w>g ? FCFF[N-1]*(1+g)/(w-g) : NaN;      // Gordon
  const pvTVg = isFinite(TVg)? TVg*disc[N-1] : NaN;
  const TVx = R.EBITDA[N-1]*H.dcfExit;                 // multiple de sortie (contre-vérif.)
  const pvTVx = TVx*disc[N-1];
  const EV = sumPV + (isFinite(pvTVg)?pvTVg:0);        // EV principal = Gordon
  const EVx = sumPV + pvTVx;                            // EV alternatif = multiple
  const netDebt = R.detteOuv[0] - R.openTreso;         // dette nette à la date de valorisation (ouverture, trésorerie calculée)
  return {N,w,g,NOPAT,addDA,capex,dBFR,FCFF,disc,PV,sumPV,
          TVg,pvTVg,TVx,pvTVx,EV,EVx,netDebt,equity:EV-netDebt,equityX:EVx-netDebt,
          tvShare: EV? pvTVg/EV : NaN, impliedMult: R.EBITDA[N-1]? EV/R.EBITDA[N-1] : NaN};
}
function renderDCF(R,H){                              // partie DOM (KPIs + tableaux) — sûre même onglet masqué
  const d=computeDCF(R,H);
  const gapOK = d.w>d.g;
  const kpi=(lab,val,sub,tip)=>`<div class="kpi"><div class="k-lab">${lab}${tip?tipHTML(tip):''}</div>
    <div class="k-val">${val}</div>${sub?`<div class="k-sub">${sub}</div>`:''}</div>`;
  document.getElementById('dcfKpis').innerHTML =
    kpi("Valeur d'entreprise (EV)", gapOK?fEUR(d.EV):'n.s.', "Gordon · WACC "+fPCT(d.w)+" / g "+fPCT(d.g),
        "Enterprise Value = flux actualisés + valeur terminale de Gordon. 'n.s.' si g ≥ WACC.")
  + kpi("Valeur des capitaux propres", gapOK?fEUR(d.equity):'n.s.', "EV − dette nette ("+fEUR(d.netDebt)+")",
        "Equity value = ce que valent les actions = EV moins la dette nette d'ouverture.")
  + kpi("Poids de la valeur terminale", gapOK?fPCT(d.tvShare):'n.s.', "part de l'EV au-delà de l'horizon",
        "Part de l'EV qui vient de la valeur terminale. Au-dessus de ~75 %, la valo repose surtout sur des hypothèses long terme (fragile).")
  + kpi("EV/EBITDA implicite", gapOK?fX(d.impliedMult):'n.s.', "vs multiple de sortie "+fX(H.dcfExit),
        "Multiple d'EBITDA (dernière année) auquel revient la valorisation Gordon. À comparer au multiple de sortie pour juger la cohérence.")
  + kpi("EV (multiple de sortie)", fEUR(d.EVx), "contre-vérif. · "+fX(H.dcfExit)+" EV/EBITDA",
        "Valeur d'entreprise si la valeur terminale = revente à ce multiple d'EBITDA. Sert de garde-fou à la méthode de Gordon.");

  // tableau FCFF
  const line=(lab,arr,tot=false)=>`<tr class="${tot?'tot':''}"><td>${lab}</td>${arr.map(v=>`<td>${fEUR(v)}</td>`).join('')}</tr>`;
  let h=`<tr><th>(en €)</th>${ANNEES.map(a=>`<th>${a}</th>`).join('')}</tr>`;
  h+=line("EBIT",R.EBIT);
  h+=line("− Impôt normatif (NOPAT)",d.NOPAT,true);
  h+=line("+ Dotations amortissements",d.addDA);
  h+=line("− CAPEX",d.capex.map(x=>-x));
  h+=line("− Variation du BFR",d.dBFR.map(x=>-x));
  h+=line("= Flux disponible (FCFF)",d.FCFF,true);
  h+=`<tr><td>Facteur d'actualisation</td>${d.disc.map(v=>`<td>${v.toFixed(3).replace('.',',')}</td>`).join('')}</tr>`;
  h+=line("Flux actualisé (PV)",d.PV,true);
  document.getElementById('dcfTbl').innerHTML=h;

  // sensibilité EV : WACC (lignes) × g (colonnes)
  const wBase=H.wacc, gBase=H.dcfG;
  const wRow=[-0.02,-0.01,0,0.01,0.02].map(x=>wBase+x).filter(x=>x>0);
  const gCol=[-0.01,-0.005,0,0.005,0.01].map(x=>gBase+x);
  let s=`<thead><tr><th>EV — WACC ＼ g</th>${gCol.map(g=>`<th class="${Math.abs(g-gBase)<1e-9?'cmp-cur':''}">${fPCT(g)}</th>`).join('')}</tr></thead><tbody>`;
  wRow.forEach(w=>{
    s+=`<tr><td class="${Math.abs(w-wBase)<1e-9?'cmp-cur':''}">${fPCT(w)}</td>`+
       gCol.map(g=>{ const ev=dcfEV(R,H,w,g); const cur=Math.abs(w-wBase)<1e-9&&Math.abs(g-gBase)<1e-9;
         return `<td class="${cur?'best':''}">${isFinite(ev)?fEUR(ev):'n.s.'}</td>`; }).join('')+`</tr>`;
  });
  document.getElementById('dcfSens').innerHTML=s+`</tbody>`;
}
function renderDCFCharts(R,H){                        // graphes (uniquement quand l'onglet DCF est visible)
  const d=computeDCF(R,H);
  const kEUR={...TICK,callback:v=>(v/1000)+'k'};
  // flux actualisés par année + PV de la valeur terminale
  mkChart('cDcfPV',{type:'bar',data:{labels:[...ANNEES,'Val. term.'],datasets:[
      {label:'Flux actualisé',data:[...d.PV, isFinite(d.pvTVg)?d.pvTVg:0],
       backgroundColor:[...d.PV.map(()=>C.blue),C.aqua],...BAR}]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:kEUR}}}});
  // pont EV → equity (barres flottantes)
  const ev=isFinite(d.EV)?d.EV:0;
  mkChart('cDcfBridge',{type:'bar',data:{labels:["Valeur d'entreprise","− Dette nette","Capitaux propres"],datasets:[
      {label:'base',data:[0, Math.min(ev,d.equity), 0],backgroundColor:'rgba(0,0,0,0)',...BAR,stack:'s'},
      {label:'valeur',data:[ev, Math.abs(d.netDebt), d.equity],
       backgroundColor:[C.blue,C.critical,C.good],...BAR,stack:'s'}]},
    options:{responsive:true,plugins:{legend:LEG(false)},scales:{x:{grid:{display:false},ticks:TICK,stacked:true},y:{grid:GRID,ticks:kEUR,stacked:true}}}});
}

// ============================================================
//  PERSISTANCE (localStorage) + en-tête d'impression
// ============================================================
const LS_KEY='pilotePME.v1';
let docCompany='', docSubtitle='';   // identité du document, demandée au moment de l'export PDF
function currentState(){
  const H={}; GROUPS.flatMap(g=>g.items).forEach(it=>{ const el=document.getElementById('num_'+it.key); if(el) H[it.key]=el.value; });
  syncDecFromDOM();
  const decInst=decInstances.map(o=>({id:o.id, type:o.type, nom:o.nom, active:o.active,
                                      vals:Object.assign({},o.vals), ov:JSON.parse(JSON.stringify(o.ov||{}))}));
  return {company:docCompany, subtitle:docSubtitle, openMode, fund:{...fund}, H, loans:JSON.parse(JSON.stringify(financeLoans)), refs:JSON.parse(JSON.stringify(refs)), decInstances:decInst, ov:JSON.parse(JSON.stringify(overrides)), kpiPins:kpiPins.slice()};
}
function saveState(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(currentState())); }catch(e){/* ignore */} }
function applyState(s){
  if(!s) return;
  docCompany=(s.company||''); docSubtitle=(s.subtitle||'');
  openMode=(s.openMode==='funding')?'funding':'treso';
  fund=Object.assign({...FUND_DEF}, (s.fund&&typeof s.fund==='object')?s.fund:{});
  if(s.H) GROUPS.flatMap(g=>g.items).forEach(it=>{ if(s.H[it.key]!=null) setVal(it.key, s.H[it.key]); });
  if(Array.isArray(s.loans)){ financeLoans=JSON.parse(JSON.stringify(s.loans)); renderLoanList(); }
  refs = migrateRefsFromState(s); if(document.getElementById('refList')) renderRefList();
  overrides = (s.ov && typeof s.ov==='object' && !Array.isArray(s.ov)) ? JSON.parse(JSON.stringify(s.ov)) : {};
  decInstances = instancesFromState(s);   // format instances, sinon migration ancien format {dec:{...}}
  kpiPins = pinsFromState(s);             // absent des scénarios d'avant → repli sur le défaut
  buildDecisions();
  finSummary();
  syncFundInputs(); renderOpeningMode();
}
function loadState(){ let s; try{ s=JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){ return; } applyState(s); }
// nom d'entreprise pour l'en-tête PDF / CSV — saisi à l'export, repli sur « Entreprise »
function companyName(){ return (docCompany||'').trim() || 'Entreprise'; }
function updatePrintHead(){
  const el=document.getElementById('printHead'); if(!el) return;
  const co=esc(companyName());
  const sub=esc((docSubtitle||'').trim() || 'Business plan prévisionnel');
  const d=new Date().toLocaleDateString('fr-FR',{year:'numeric',month:'long',day:'numeric'});
  el.innerHTML=`<div class="ph-top"><span class="ph-issuer">Specularé</span><span class="ph-conf">Confidentiel</span></div>`+
    `<div class="ph-co">${co}</div>`+
    `<div class="ph-sub">${sub} · horizon ${NY} ans · édité le ${d}</div>`;
  const foot=document.getElementById('printFoot');
  if(foot) foot.innerHTML=`<span>${co}</span><span>Édité avec Specularé · Document confidentiel</span>`;
}
// ---- Modale « Exporter en PDF » : on demande le nom de l'entreprise avant d'imprimer ----
function openExportModal(){
  let m=document.getElementById('exportModal');
  if(!m){
    m=document.createElement('div'); m.className='modal-overlay'; m.id='exportModal';
    m.innerHTML=`<div class="modal" style="max-width:470px">
      <div class="modal-head"><h2>Exporter en PDF</h2>
        <button class="modal-close" id="expClose" title="Fermer">✕</button></div>
      <p class="modal-sub">Ces informations apparaissent en tête du document (destiné à des investisseurs, banques…).</p>
      <label class="exp-field"><span>Nom de l'entreprise</span>
        <input type="text" id="expCompany" class="exp-input" placeholder="Ex. MécaFluid SAS" maxlength="60"></label>
      <label class="exp-field"><span>Sous-titre <em>(optionnel)</em></span>
        <input type="text" id="expSubtitle" class="exp-input" placeholder="Business plan prévisionnel" maxlength="80"></label>
      <div class="exp-hint">Dans la fenêtre d'impression : destination <b>« Enregistrer au format PDF »</b> et décoche <b>En-têtes et pieds de page</b> du navigateur pour un rendu net.</div>
      <div class="modal-foot"><button class="scn-btn" id="expCancel" style="flex:none;width:auto;padding:9px 16px">Annuler</button><button class="btn-primary" id="expGo">Exporter en PDF</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
    document.getElementById('expClose').addEventListener('click',()=>m.classList.remove('open'));
    document.getElementById('expCancel').addEventListener('click',()=>m.classList.remove('open'));
    const go=()=>{
      docCompany=document.getElementById('expCompany').value.trim();
      docSubtitle=document.getElementById('expSubtitle').value.trim();
      saveState(); updatePrintHead(); m.classList.remove('open');
      setTimeout(()=>window.print(), 80);   // laisse la modale se fermer avant le dialogue d'impression
    };
    document.getElementById('expGo').addEventListener('click',go);
    m.querySelectorAll('.exp-input').forEach(inp=>inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } }));
  }
  document.getElementById('expCompany').value=docCompany||'';
  document.getElementById('expSubtitle').value=docSubtitle||'';
  m.classList.add('open');
  setTimeout(()=>{ const f=document.getElementById('expCompany'); if(f) f.focus(); }, 40);
}
document.getElementById('btnExport').addEventListener('click', openExportModal);

// ---- Export CSV (ouvrable dans Excel) ----
function csvNum(v,kind){
  if(!isFinite(v)) return '';
  if(kind==='pct') return (v*100).toFixed(1).replace('.',',');
  if(kind==='x')   return v.toFixed(1).replace('.',',');
  return String(Math.round(v));   // money / jours / entier
}
function exportCSV(){
  if(!lastR) return;
  const R=lastR, sep=';';
  const company=companyName();
  const d=new Date().toLocaleDateString('fr-FR');
  const rows=[[company],['Business plan '+NY+' ans — édité le '+d],[],['Indicateur','Unité',...ANNEES]];
  const L=(lab,arr,kind,unit)=>rows.push([lab,unit,...arr.map(v=>csvNum(v,kind))]);
  L("Chiffre d'affaires",R.CA,'money','€');
  L("Croissance du CA",R.croiss,'pct','%');
  L("Charges variables",R.chgv.map(x=>-x),'money','€');
  L("Marge sur coûts variables",R.marge,'money','€');
  L("Charges fixes",R.cf.map(x=>-x),'money','€');
  L("Charges de personnel",R.perso.map(x=>-x),'money','€');
  L("EBITDA",R.EBITDA,'money','€');
  L("Marge d'EBITDA",R.margeEBITDA,'pct','%');
  L("Dotation amortissements",R.dot.map(x=>-x),'money','€');
  L("EBIT",R.EBIT,'money','€');
  L("Charges financières",R.chgfin.map(x=>-x),'money','€');
  if(R.resExcept.some(x=>Math.abs(x)>0.5)) L("Résultat de cession",R.resExcept,'money','€');
  L("Résultat avant impôt",R.RAI,'money','€');
  L("Impôt sur les sociétés",R.IS.map(x=>-x),'money','€');
  L("Résultat net",R.RN,'money','€');
  L("Trésorerie de clôture",R.tresoClot,'money','€');
  L("BFR (jours de CA)",R.bfrJours,'j','jours');
  L("Dette nette",R.detteNette,'money','€');
  L("Dette nette / EBITDA",R.levier,'x','×');
  L("ROCE (après impôt)",R.ROCE,'pct','%');
  L("Point mort (CA)",R.pointMort,'money','€');
  L("Marge de sécurité",R.margeSecu,'pct','%');
  const csv=rows.map(r=>r.join(sep)).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=(company.replace(/[^\w\-]+/g,'_')||'pilote-pme')+'_business-plan.csv';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
document.getElementById('btnCsv').addEventListener('click',exportCSV);

// ============================================================
//  SCÉNARIOS NOMMÉS + COMPARAISON
// ============================================================
const SCN_KEY='pilotePME.scenarios';
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getScenarios(){ try{ return JSON.parse(localStorage.getItem(SCN_KEY))||{}; }catch(e){ return {}; } }
function setScenarios(o){ try{ localStorage.setItem(SCN_KEY, JSON.stringify(o)); }catch(e){/* ignore */} }
function renderScenarioList(){
  const scn=getScenarios(); const names=Object.keys(scn);
  const root=document.getElementById('scnList');
  if(!names.length){ root.innerHTML='<div class="scn-empty">Aucun scénario enregistré. Définir des hypothèses et des décisions, puis « Enregistrer ».</div>'; return; }
  root.innerHTML=names.map(n=>{
    const d=encodeURIComponent(n);
    return `<div class="scn">
      <input type="checkbox" class="scn-cmp" data-name="${d}" title="Cocher pour comparer">
      <span class="scn-name" data-name="${d}" title="Charger ce scénario">${esc(n)}</span>
      <button class="scn-ic scn-dup" data-name="${d}" title="Dupliquer">⧉</button>
      <button class="scn-ic scn-ren" data-name="${d}" title="Renommer">✎</button>
      <button class="scn-ic scn-del" data-name="${d}" title="Supprimer">✕</button>
    </div>`;
  }).join('');
  root.querySelectorAll('.scn-name').forEach(e=>e.addEventListener('click',()=>loadScenario(decodeURIComponent(e.dataset.name))));
  root.querySelectorAll('.scn-dup').forEach(e=>e.addEventListener('click',()=>duplicateScenario(decodeURIComponent(e.dataset.name))));
  root.querySelectorAll('.scn-ren').forEach(e=>e.addEventListener('click',()=>renameScenario(decodeURIComponent(e.dataset.name))));
  root.querySelectorAll('.scn-del').forEach(e=>e.addEventListener('click',()=>deleteScenario(decodeURIComponent(e.dataset.name))));
}
function duplicateScenario(name){
  const scn=getScenarios(); if(!scn[name]) return;
  let nn=(prompt('Nom de la copie :', name+' (copie)')||'').trim(); if(!nn) return;
  scn[nn]=JSON.parse(JSON.stringify(scn[name])); setScenarios(scn); renderScenarioList();
}
function renameScenario(name){
  const scn=getScenarios(); if(!scn[name]) return;
  let nn=(prompt('Nouveau nom :', name)||'').trim(); if(!nn || nn===name) return;
  const out={}; Object.keys(scn).forEach(k=>{ out[k===name?nn:k]=scn[k]; }); // conserve l'ordre
  setScenarios(out); renderScenarioList();
}
function saveScenario(){
  const name=(prompt('Nom du scénario :','')||'').trim();
  if(!name) return;
  const scn=getScenarios(); scn[name]=currentState(); setScenarios(scn); renderScenarioList();
}
function loadScenario(name){ const scn=getScenarios(); if(scn[name]){ applyState(scn[name]); applyHorizon(); } }
function deleteScenario(name){
  if(!confirm('Supprimer le scénario « '+name+' » ? Cette action est définitive.')) return;
  const scn=getScenarios(); delete scn[name]; setScenarios(scn); renderScenarioList();
}

// recompute pur (sans DOM) à partir d'un état stocké
function computeFromState(s){
  const H={};
  GROUPS.flatMap(g=>g.items).forEach(it=>{ let v=parseFloat(s.H?s.H[it.key]:NaN); if(isNaN(v))v=0; H[it.key]= it.kind==='pct'?v/100:v; });
  H.loans = Array.isArray(s.loans) ? s.loans : LOANS_DEF;
  H.refs = engineRefs(migrateRefsFromState(s));   // références (nouveau format) ou migration mono-produit
  H.ov={};
  if(s.ov) PERYEAR_KEYS.forEach(k=>{
    // base en N : reprise de l'état sauvegardé, pas des champs à l'écran
    const a=ovSeries(s.ov[k], (s.H&&s.H[k]!=null)? s.H[k] : autoVal(k,0));
    if(a){ const pct=ITEM[k].kind==='pct'; H.ov[k]= pct? a.map(v=>v/100) : a; }
  });
  const decs=instancesFromState(s).map(toEngineDec);
  const R=compute(H, decs);
  R.__H=H;   // les KPI qui comparent à une hypothèse (ROCE − WACC) ont besoin du H du scénario
  return R;
}
const CMP_PAL=['#2a78d6','#1baf7a','#eda100','#4a3aa7','#eb6834','#e34948'];
let cmpChart=null;
function openComparison(){
  const scn=getScenarios();
  const checked=[...document.querySelectorAll('.scn-cmp:checked')].map(c=>decodeURIComponent(c.dataset.name));
  const cols=checked.map(n=>({name:n, state:scn[n], cur:false}));
  if(cols.length<2){ alert('Coche au moins deux scénarios enregistrés pour les comparer.'); return; }
  const results=cols.map(c=>({...c, R:computeFromState(c.state)}));

  const rows=KPI_DEFS.map(k=>{
    const vals=results.map(r=>k.get(r.R, r.R.__H));
    const finite=vals.filter(v=>isFinite(v));
    const best = finite.length ? (KPI_HIGOOD[k.id]?Math.max(...finite):Math.min(...finite)) : null;
    const tds=vals.map(v=>{
      const isBest = best!==null && isFinite(v) && Math.abs(v-best)<1e-9;
      return `<td class="${isBest?'best':''}">${k.fmt(v)}</td>`;
    }).join('');
    return `<tr><td>${k.lab}</td>${tds}</tr>`;
  }).join('');
  const headCols=results.map(r=>`<th class="${r.cur?'cmp-cur':''}">${esc(r.name)}</th>`).join('');
  const table=`<div class="cmp-scroll"><table class="cmp-table"><thead><tr><th>Indicateur (${ANNEES[NY-1]})</th>${headCols}</tr></thead><tbody>${rows}</tbody></table></div>`;

  const metrics=[{k:'tresoClot',l:'Trésorerie de clôture',u:'money'},{k:'CA',l:"Chiffre d'affaires",u:'money'},
    {k:'EBITDA',l:'EBITDA',u:'money'},{k:'RN',l:'Résultat net',u:'money'},
    {k:'levier',l:'Dette nette / EBITDA',u:'x'},{k:'ROCE',l:'ROCE (après impôt)',u:'pct'},
    {k:'bfrJours',l:'BFR (jours de CA)',u:'j'}];

  let modal=document.getElementById('cmpModal');
  if(!modal){ modal=document.createElement('div'); modal.className='modal-overlay'; modal.id='cmpModal'; document.body.appendChild(modal); }
  modal.innerHTML=`<div class="modal">
    <div class="modal-head"><h2>Comparaison de scénarios</h2>
      <button class="modal-close" id="cmpClose">✕</button></div>
    <p class="modal-sub">Meilleure valeur de chaque ligne en vert.</p>
    ${table}
    <div style="display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap">
      <h3 style="font-size:13px;color:var(--ink-2);margin:0">Évolution comparée —</h3>
      <select id="cmpMetric">${metrics.map(m=>`<option value="${m.k}" data-u="${m.u}">${m.l}</option>`).join('')}</select>
    </div>
    <div style="height:270px"><canvas id="cmpTreso"></canvas></div>
  </div>`;
  modal.classList.add('open');
  document.getElementById('cmpClose').addEventListener('click',()=>modal.classList.remove('open'));
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });

  function drawCmp(mk,unit){
    const cb = unit==='money'?(v=>(v/1000)+'k') : unit==='pct'?(v=>(v*100).toFixed(0)+'%')
             : unit==='x'?(v=>v+'×') : (v=>v+' j');
    if(cmpChart) cmpChart.destroy();
    cmpChart=new Chart(document.getElementById('cmpTreso'),{type:'line',
      data:{labels:ANNEES,datasets:results.map((r,i)=>({label:r.name,data:r.R[mk],
        borderColor:CMP_PAL[i%CMP_PAL.length],backgroundColor:CMP_PAL[i%CMP_PAL.length],
        borderWidth:2,pointRadius:3,tension:.3,borderDash:r.cur?[6,4]:[]}))},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:LEG(true)},
        scales:{x:{grid:{display:false},ticks:TICK},y:{grid:GRID,ticks:{...TICK,callback:cb}}}}});
  }
  const sel=document.getElementById('cmpMetric');
  sel.addEventListener('change',()=>{ const o=sel.options[sel.selectedIndex]; drawCmp(sel.value,o.dataset.u); });
  drawCmp('tresoClot','money');
}
document.getElementById('btnSaveScn').addEventListener('click',saveScenario);
document.getElementById('btnCompare').addEventListener('click',openComparison);

// ---- Reset ----
document.getElementById('reset').addEventListener('click',()=>{
  GROUPS.flatMap(g=>g.items).forEach(it=>setVal(it.key,it.v));
  overrides={};
  financeLoans=JSON.parse(JSON.stringify(LOANS_DEF));
  refs=JSON.parse(JSON.stringify(REFS_DEF)); renderRefList(); refSummary();
  renderLoanList(); finSummary();
  decInstances=defaultInstances(); buildDecisions();
  openMode='treso'; fund={...FUND_DEF}; syncFundInputs(); renderOpeningMode();
  kpiPins=KPI_PINS_DEF.slice();
  applyHorizon();   // remet l'horizon à 5 ans et recalcule
});

// ============================================================
//  NAVIGATION ET REPLIS (rail + tiroir)
// ============================================================
const appEl = document.getElementById('app');
function setDrawer(open){ appEl.classList.toggle('drawer-off', !open); }

// un seul écouteur : rail, fil d'Ariane et renvois « Ouvrir … → » portent tous data-go
document.addEventListener('click',e=>{
  const go = e.target.closest && e.target.closest('[data-go]');
  if(!go) return;
  e.preventDefault();
  navigate(go.dataset.go);
});
// ---- Réticule de lecture des tableaux : surligne la colonne survolée ----
// Écouteur délégué sur document : les tableaux sont réécrits en innerHTML à chaque
// recalcul, un écouteur posé sur eux ne survivrait pas.
let hlTable=null, hlCol=-1;
function clearColHL(){
  if(hlTable) hlTable.querySelectorAll('.colhl').forEach(c=>c.classList.remove('colhl'));
  hlTable=null; hlCol=-1;
}
document.addEventListener('mouseover',e=>{
  const cell = e.target.closest && e.target.closest('.tblwrap td, .tblwrap th');
  if(!cell){ if(hlTable) clearColHL(); return; }
  const tbl=cell.closest('table'), i=cell.cellIndex;
  if(tbl===hlTable && i===hlCol) return;          // même colonne : rien à refaire
  clearColHL();
  if(i<=0) return;                                // la colonne des libellés ne s'éclaire pas
  hlTable=tbl; hlCol=i;
  tbl.querySelectorAll('tr').forEach(tr=>{
    if(tr.classList.contains('grouprow')) return; // bandeau de section : une seule cellule
    const c=tr.children[i]; if(c) c.classList.add('colhl');
  });
});

// La flèche pointe TOUJOURS vers l'action à venir : ⟨ pour replier, ⟩ pour déplier.
function syncRail(){
  const min=appEl.classList.contains('rail-min');
  const b=document.getElementById('btnRail');
  b.querySelector('i').textContent = min ? '⟩' : '⟨';
  b.title = min ? 'Déplier le menu' : 'Réduire le menu';
  const brand=document.querySelector('.rail-brand');
  brand.title = min ? 'Déplier le menu' : '';
}
function toggleRail(){ appEl.classList.toggle('rail-min'); syncRail(); }
document.getElementById('btnRail').addEventListener('click',toggleRail);
// rail replié : le logo devient la zone de déploiement (cible large, réflexe courant)
document.querySelector('.rail-brand').addEventListener('click',()=>{
  if(appEl.classList.contains('rail-min')) toggleRail();
});
syncRail();
document.getElementById('btnDrawerClose').addEventListener('click',()=>setDrawer(false));
document.getElementById('btnDrawerTab').addEventListener('click',()=>setDrawer(true));
document.querySelectorAll('.drawer-toggle').forEach(b=>
  b.addEventListener('click',()=>setDrawer(appEl.classList.contains('drawer-off'))));
// l'entrée « Comparer » du rail rejoue le bouton du tiroir, pour n'avoir qu'un seul gestionnaire
document.getElementById('railCompare').addEventListener('click',()=>document.getElementById('btnCompare').click());

// ---- Démarrage ----
buildDecisions();
buildInputs();
buildOpeningMode();
buildFinanceModal();
buildRefModal();
buildCapModal();
buildPinModal();
buildPackNav();
buildYearModal();   // en dernier : son overlay doit se superposer aux autres modales
loadState();      // restaure les saisies précédentes si présentes
renderScenarioList();
applyHorizon();   // synchronise l'horizon (NY/ANNEES) avec le paramètre restauré, puis recalcule
navigate('apercu');   // vue par défaut + filtrage contextuel du tiroir

// ============================================================
//  FEUILLE DU BAS (mobile) — l'aside coulisse en bottom sheet
//  États : peek (poignée seule) → half (mi-hauteur) → full (plein) → peek
//  Piloté par matchMedia : totalement inerte au-dessus de 768px.
// ============================================================
const mqMobile = matchMedia('(max-width:768px)');
let sheetState='peek';
const SHEET_PEEK=60;
function sheetHeights(){ const vh=innerHeight; return {peek:SHEET_PEEK, half:Math.round(vh*0.56), full:Math.round(vh*0.92)}; }
function setSheet(s){
  sheetState=s;
  const a=document.querySelector('aside');
  if(a){
    a.classList.remove('sheet-half','sheet-full');
    if(s==='half') a.classList.add('sheet-half'); else if(s==='full') a.classList.add('sheet-full');
    a.dataset.sheet=s; a.style.height='';   // rend la main à la hauteur pilotée par le CSS (transition)
  }
  document.body.classList.toggle('sheet-open', s!=='peek');
}
function cycleSheet(){ setSheet(sheetState==='peek'?'half':sheetState==='half'?'full':'peek'); }
function nearestState(px){
  const h=sheetHeights(); let best='peek', bd=Infinity;
  for(const k of ['peek','half','full']){ const d=Math.abs(h[k]-px); if(d<bd){ bd=d; best=k; } }
  return best;
}
function applySheetMode(){
  const a=document.querySelector('aside'); if(!a) return;
  if(mqMobile.matches){ if(!a.dataset.sheet) a.dataset.sheet='peek'; sheetState=a.dataset.sheet; }
  else { a.removeAttribute('data-sheet'); a.classList.remove('sheet-half','sheet-full'); a.style.height=''; document.body.classList.remove('sheet-open'); sheetState='peek'; }
}
(function initSheet(){
  const a=document.querySelector('aside');
  const h=document.getElementById('sheetHandle');
  mqMobile.addEventListener('change', applySheetMode);
  applySheetMode();
  if(!a || !h) return;
  // glisser-au-doigt : on redimensionne la feuille pendant le drag, on snappe au relâchement ; un simple tap cycle.
  let dragging=false, startY=0, startH=0, moved=false;
  h.addEventListener('pointerdown',e=>{
    if(!mqMobile.matches) return;
    dragging=true; moved=false; startY=e.clientY; startH=a.getBoundingClientRect().height;
    a.classList.add('dragging'); try{ h.setPointerCapture(e.pointerId); }catch(_){}
  });
  h.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const dy=startY-e.clientY; if(Math.abs(dy)>5) moved=true;
    const hs=sheetHeights();
    const nh=Math.max(hs.peek, Math.min(hs.full, startH+dy));
    a.style.height=nh+'px';
    document.body.classList.toggle('sheet-open', nh>hs.peek+8);
  });
  const end=()=>{
    if(!dragging) return; dragging=false; a.classList.remove('dragging');
    if(!moved){ cycleSheet(); return; }                 // tap = cycle peek → half → full
    setSheet(nearestState(a.getBoundingClientRect().height));   // drag = snap à l'accroche la plus proche
  };
  h.addEventListener('pointerup',end);
  h.addEventListener('pointercancel',end);
  h.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&mqMobile.matches){ e.preventDefault(); cycleSheet(); } });
})();
