// Flag Master trivia: short "name them all" list quizzes.
// Each quiz lists answer ids from FLAG_DATA. `ranked` shows numbered slots in order.
// `grid` allows the "click the flags" mode (answers mixed with decoys).
// `noDecoy` keeps arguable flags out of the decoy pool.
// Facts checked November 2026: populations are UN 2025 estimates, areas are total area.
const FM_TRIVIA = (() => {
  const w = s => s.trim().split(/\s+/).map(c => 'world:' + c);
  const us = s => s.trim().split(/\s+/).map(c => 'us:us-' + c);
  const D = FLAG_DATA;
  const region = r => D.countries.filter(f => f.region === r).map(f => f.id);
  const sub = s => D.countries.filter(f => f.sub === s).map(f => f.id);

  const Q = [
    // ---- Flags ----
    { id: 'red-white', section: 'Flags', icon: '🟥', title: 'Only Red and White', desc: 'Countries whose flag uses nothing but red and white.', note: 'Qatar\'s maroon counts as red.', grid: true,
      answers: w('at bh ca dk ge id jp lv mt mc pe pl qa sg ch to tn tr') },
    { id: 'blue-white', section: 'Flags', icon: '🟦', title: 'Only Blue and White', desc: 'Countries whose flag uses nothing but blue and white.', grid: true,
      answers: w('fi gr hn il fm so'), noDecoy: w('ar uy sv gt ni') },
    { id: 'crescent', section: 'Flags', icon: '☪️', title: 'Crescent Moons', desc: 'Countries with a crescent on their flag.', grid: true,
      answers: w('dz az bn km ly my mv mr pk sg tn tr tm uz'), noDecoy: w('np') },
    { id: 'union-jack', section: 'Flags', icon: '🇬🇧', title: 'Union Jacks', desc: 'Countries whose flag includes the Union Jack.', grid: true,
      answers: w('gb au nz fj tv') },
    { id: 'nordic-cross', section: 'Flags', icon: '✚', title: 'Nordic Crosses', desc: 'Sovereign countries flying a Nordic cross.', grid: true,
      answers: w('dk fi is no se') },

    // ---- People & size ----
    { id: 'pop10', section: 'People & Size', icon: '👥', title: 'Most Populous Countries', desc: 'The 10 countries with the most people, in order.', ranked: true, grid: true,
      answers: w('in cn us id pk ng br bd ru mx') },
    { id: 'pop100', section: 'People & Size', icon: '🏙️', title: 'The 100 Million Club', desc: 'Every country with more than 100 million people.', grid: true,
      answers: w('in cn us id pk ng br bd ru mx et jp ph eg cd vn') },
    { id: 'area10', section: 'People & Size', icon: '📐', title: 'Largest Countries', desc: 'The 10 biggest countries by total area, in order.', ranked: true, grid: true,
      answers: w('ru ca us cn br au in ar kz dz') },
    { id: 'small10', section: 'People & Size', icon: '🔬', title: 'Smallest Countries', desc: 'The 10 smallest countries by area, smallest first.', ranked: true, grid: true,
      answers: w('va mc nr tv sm li mh kn mv mt') },

    // ---- Borders & geography ----
    { id: 'one-neighbor', section: 'Borders & Geography', icon: '🤝', title: 'Just One Neighbor', desc: 'Countries that share a land border with exactly one other country.', grid: true,
      answers: w('bn ca dk do gm ht ie ls mc pg pt qa sm kr tl gb va') },
    { id: 'border-china', section: 'Borders & Geography', icon: '🐉', title: 'Neighbors of China', desc: 'All 14 countries that border China.', grid: true,
      answers: w('af bt in kz kg la mn mm np kp pk ru tj vn') },
    { id: 'border-russia', section: 'Borders & Geography', icon: '🐻', title: 'Neighbors of Russia', desc: 'All 14 countries that border Russia.', note: 'Includes the borders of Kaliningrad.', grid: true,
      answers: w('no fi ee lv lt pl by ua ge az kz cn mn kp') },
    { id: 'border-brazil', section: 'Borders & Geography', icon: '🌴', title: 'Neighbors of Brazil', desc: 'The 10 countries that border Brazil.', note: 'France counts, through French Guiana.', grid: true,
      answers: w('ar bo co gy py pe sr uy ve fr') },
    { id: 'equator', section: 'Borders & Geography', icon: '🌐', title: 'On the Equator', desc: 'The 13 countries the equator passes through.', grid: true,
      answers: w('st ga cg cd ug ke so mv id ki ec co br') },
    { id: 'meridian', section: 'Borders & Geography', icon: '🕛', title: 'On the Prime Meridian', desc: 'The 8 countries the 0° line passes through.', grid: true,
      answers: w('gb fr es dz ml bf tg gh') },
    { id: 'landlocked-africa', section: 'Borders & Geography', icon: '🏜️', title: 'Landlocked Africa', desc: 'The 16 African countries with no coastline.', grid: true,
      answers: w('bw bf bi cf td sz et ls mw ml ne rw ss ug zm zw') },
    { id: 'landlocked', section: 'Borders & Geography', icon: '⛰️', title: 'Every Landlocked Country', desc: 'All 45 countries with no coastline.', note: 'The Caspian is a lake, so Azerbaijan and Kazakhstan count.',
      answers: w('bw bf bi cf td sz et ls mw ml ne rw ss ug zm zw ad at by cz hu xk li lu md mk sm rs sk ch va af bt kz kg la mn np tj tm uz am az bo py') },
    { id: 'double-landlocked', section: 'Borders & Geography', icon: '🔒', title: 'Doubly Landlocked', desc: 'Landlocked countries surrounded only by landlocked countries. There are just two.', grid: true,
      answers: w('li uz') },
    { id: 'stans', section: 'Borders & Geography', icon: '🐫', title: 'The Stans', desc: 'Every country whose name ends in -stan.', grid: true,
      answers: w('af kz kg pk tj tm uz') },
    { id: 'guineas', section: 'Borders & Geography', icon: '🔤', title: 'The Guineas', desc: 'Every country with Guinea in its name.', grid: true,
      answers: w('gn gw gq pg') },

    // ---- Clubs & languages ----
    { id: 'g7', section: 'Clubs & Languages', icon: '💼', title: 'The G7', desc: 'The seven members of the Group of Seven.', grid: true,
      answers: w('ca fr de it jp gb us') },
    { id: 'p5', section: 'Clubs & Languages', icon: '🛡️', title: 'UN Security Council', desc: 'The five permanent members.', grid: true,
      answers: w('cn fr ru gb us') },
    { id: 'eu', section: 'Clubs & Languages', icon: '🇪🇺', title: 'European Union', desc: 'All 27 member states.',
      answers: w('at be bg hr cy cz dk ee fi fr de gr hu ie it lv lt lu mt nl pl pt ro sk si es se') },
    { id: 'euro', section: 'Clubs & Languages', icon: '💶', title: 'The Eurozone', desc: 'The 21 EU members that use the euro.', note: 'Bulgaria joined on 1 January 2026.', grid: true,
      answers: w('at be bg hr cy ee fi fr de gr ie it lv lt lu mt nl pt sk si es') },
    { id: 'nato', section: 'Clubs & Languages', icon: '🧭', title: 'NATO', desc: 'All 32 member countries.',
      answers: w('al be bg ca hr cz dk ee fi fr de gr hu is it lv lt lu me nl mk no pl pt ro sk si es se tr gb us') },
    { id: 'spanish', section: 'Clubs & Languages', icon: '💬', title: 'Spanish Speaking', desc: 'The 20 countries where Spanish is an official language.', grid: true,
      answers: w('ar bo cl co cr cu do ec sv gq gt hn mx ni pa py pe es uy ve') },
    { id: 'portuguese', section: 'Clubs & Languages', icon: '🗣️', title: 'Portuguese Speaking', desc: 'The 9 countries where Portuguese is an official language.', grid: true,
      answers: w('ao br cv gq gw mz pt st tl') },

    // ---- United States ----
    { id: 'us-pop10', section: 'United States', icon: '🏟️', title: 'Most Populous States', desc: 'The 10 states with the most people, in order.', ranked: true, grid: true,
      answers: us('ca tx fl ny pa il oh ga nc mi') },
    { id: 'us-area10', section: 'United States', icon: '🤠', title: 'Biggest States', desc: 'The 10 largest states by total area.', grid: true,
      answers: us('ak tx ca mt nm az nv co or wy') },
    { id: 'us-small10', section: 'United States', icon: '🦞', title: 'Smallest States', desc: 'The 10 smallest states by total area.', grid: true,
      answers: us('ri de ct nj nh vt ma hi md wv') },
    { id: 'us-canada', section: 'United States', icon: '🍁', title: 'Bordering Canada', desc: 'The 13 states that share a border with Canada.', note: 'Includes borders across the Great Lakes.', grid: true,
      answers: us('ak wa id mt nd mn mi oh pa ny vt nh me') },
    { id: 'us-mexico', section: 'United States', icon: '🌵', title: 'Bordering Mexico', desc: 'The 4 states on the Mexican border.', grid: true,
      answers: us('ca az nm tx') },
    { id: 'us-13', section: 'United States', icon: '🔔', title: 'The 13 Colonies', desc: 'The states that began as the original 13 colonies.', grid: true,
      answers: us('de pa nj ga ct ma md sc nh va ny nc ri') },
    { id: 'us-gulf', section: 'United States', icon: '🦐', title: 'Gulf Coast', desc: 'The 5 states on the Gulf of Mexico.', grid: true,
      answers: us('tx la ms al fl') },
    { id: 'us-pacific', section: 'United States', icon: '🌊', title: 'Pacific Coast', desc: 'The 5 states on the Pacific Ocean.', grid: true,
      answers: us('ak ca hi or wa') },
    { id: 'four-corners', section: 'United States', icon: '✖️', title: 'Four Corners', desc: 'The states that meet at a single point.', grid: true,
      answers: us('az co nm ut') },

    // ---- Name them all ----
    { id: 'all-sa', section: 'Name Them All', icon: '🦙', title: 'South America', desc: 'Every country in South America.', grid: false, answers: region('South America') },
    { id: 'all-ca', section: 'Name Them All', icon: '🌋', title: 'Central America', desc: 'Every country in Central America.', grid: false, answers: sub('Central America') },
    { id: 'all-carib', section: 'Name Them All', icon: '🏝️', title: 'The Caribbean', desc: 'Every island nation in the Caribbean.', grid: false, answers: sub('Caribbean') },
    { id: 'all-oc', section: 'Name Them All', icon: '🦘', title: 'Oceania', desc: 'Every country in Oceania.', grid: false, answers: region('Oceania') },
    { id: 'all-eu', section: 'Name Them All', icon: '🏰', title: 'Europe', desc: 'Every country in Europe.', grid: false, answers: region('Europe') },
    { id: 'all-as', section: 'Name Them All', icon: '🏯', title: 'Asia', desc: 'Every country in Asia.', grid: false, answers: region('Asia') },
    { id: 'all-af', section: 'Name Them All', icon: '🦁', title: 'Africa', desc: 'Every country in Africa.', grid: false, answers: region('Africa') },
    { id: 'all-us', section: 'Name Them All', icon: '🦅', title: 'The 50 States', desc: 'Every U.S. state.', grid: false, answers: D.states.map(f => f.id) },
    { id: 'all-world', section: 'Name Them All', icon: '🌍', title: 'The Whole World', desc: 'All 197 countries. Bring snacks.', grid: false, answers: D.countries.map(f => f.id) },
  ];
  return Q;
})();
