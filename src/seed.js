// Demo content for Gisthall. Every member, thread and post here is fictional
// and was written for this project.
import { createForum } from './lib/forum.js';
import { tx } from './db.js';

export const DEMO_ADMIN = { username: 'hallkeeper', password: 'Gisthall#2026' };
export const DEMO_PASSWORD = 'password123';

const SECTIONS = [
  ['Naija Life', [
    ['Politics & Governance', 'Elections, policies and the people running things.'],
    ['Money & Business', 'Hustles, SMEs, investing and the price of everything.'],
    ['Jobs & Careers', 'Openings, interviews, CV help and workplace wahala.'],
    ['Japa & Travel', 'Visas, relocation stories and travel tips.'],
    ['Properties & Rent', 'Landlords, agents, land titles and house hunting.'],
  ]],
  ['Entertainment', [
    ['Music & Movies', 'Afrobeats, Nollywood, albums and box office.'],
    ['Football', 'Super Eagles, the leagues and transfer gist.'],
    ['Jokes & Banter', 'Keep it light. Keep it clean-ish.'],
    ['Relationships', 'Love, marriage, family and advice.'],
  ]],
  ['Science & Tech', [
    ['Tech Corner', 'Programming, startups and the internet.'],
    ['Phones & Gadgets', 'Reviews, comparisons and repair help.'],
    ['Cars & Motoring', 'Buying, fuel, mechanics and road trips.'],
  ]],
  ['Everyday', [
    ['Kitchen & Food', 'Recipes, food prices and restaurant reviews.'],
    ['Schools & Exams', 'Admissions, exams and student life.'],
    ['Health Matters', 'Wellness, fitness and asking the right questions.'],
    ['Market Square', 'Buy, sell and swap. Beware of scammers.'],
    ['Gisthall Feedback', 'Suggestions and bug reports for the site itself.'],
  ]],
];

const MEMBERS = [
  ['tundeonthemic', 'Lagos', 'male', 'Radio voice, keyboard warrior.'],
  ['amaka_writes', 'Enugu', 'female', 'Writer. Tea over coffee.'],
  ['bayo_builds', 'Ibadan', 'male', 'Software engineer. I fix printers too, unfortunately.'],
  ['zainab_k', 'Kano', 'female', 'Pharmacist and part-time baker.'],
  ['efe_waffi', 'Warri', 'male', 'No wahala, just gist.'],
  ['chidi_analyst', 'Abuja', 'male', 'Numbers guy. Ask me about inflation.'],
  ['ronke_reads', 'Abeokuta', 'female', 'Bookworm and Nollywood critic.'],
  ['musa_motors', 'Kaduna', 'male', 'Mechanic for 15 years.'],
  ['ngozi_travels', 'Port Harcourt', 'female', 'Been to 14 countries on a Naija passport.'],
  ['dami_codes', 'Lagos', 'other', 'Frontend dev. Dark mode or nothing.'],
];

// [board, author, title, body, replies[[author, body]], featured]
const THREADS = [
  ['tech-corner', 'bayo_builds', 'Which programming language should a complete beginner start with in 2026?',
    'My younger brother just finished secondary school and wants to learn to code while waiting for admission. He has a fairly old laptop and patchy data.\n\nWhat would you recommend and why? Free resources are a big plus.',
    [['dami_codes', 'JavaScript. He can see results in the browser immediately and there are tons of free tutorials. Motivation matters more than the "perfect" language.'],
     ['chidi_analyst', 'Python. The syntax is clean and if he likes numbers he can move into data work later.'],
     ['bayo_builds', '@dami_codes good point on motivation. He likes making things look nice, so browser stuff might hook him faster.'],
     ['tundeonthemic', 'Whatever he picks, make him build small projects. Tutorials alone will not do it.']], true],
  ['money-business', 'chidi_analyst', 'Small business owners: how are you handling rising costs this year?',
    'Rent, diesel, packaging, transport, everything has gone up. I run a small printing shop and margins are getting thin.\n\nWhat changes have helped you stay afloat? Price increases, cutting hours, switching suppliers?',
    [['zainab_k', 'We moved to buying in bulk with two other shop owners on the same street. Shared delivery costs too. Saved us a lot.'],
     ['efe_waffi', 'Solar for the shop. Expensive upfront but diesel was killing me. Paid for itself in about 14 months.'],
     ['amaka_writes', 'Be honest with your customers. I put up a small notice explaining my price change and most people understood.']], true],
  ['football', 'efe_waffi', 'Who should start in midfield for the Super Eagles next match?',
    'The midfield has looked disconnected in the last few games. Too many long balls, not enough control.\n\nWho would you start and in what shape?',
    [['tundeonthemic', 'We need a proper holding midfielder first. Everything else follows from that.'],
     ['musa_motors', 'Play the young boys. Experience is good but legs are better.'],
     ['efe_waffi', '[quote author=musa_motors]Play the young boys.[/quote]\nAgreed. At least give them a run of games, not just ten minutes at the end.']], false],
  ['japa-travel', 'ngozi_travels', 'My visa application checklist (what I wish I knew the first time)',
    'After a few refusals early on, here is what finally worked for me:\n\n1. Bank statements that actually tell a story. No sudden big deposits.\n2. A clear itinerary with bookings you can cancel.\n3. Proof of ties at home: job letter, property, family.\n4. Answer interview questions short and honestly.\n\nAsk me anything.',
    [['ronke_reads', 'This is gold. How many months of statements did you submit?'],
     ['ngozi_travels', '@ronke_reads six months. Some embassies ask for three but six never hurt.'],
     ['bayo_builds', 'Saving this. The sudden deposit thing caught my cousin.']], true],
  ['kitchen-food', 'zainab_k', 'Share your cheapest filling meal ideas',
    'Food prices are no joke. Let us help each other. Mine: beans and plantain porridge with a bit of crayfish. Feeds four for very little.',
    [['amaka_writes', 'Yam pottage with lots of vegetables. The vegetables stretch it.'],
     ['efe_waffi', 'Garri, groundnut and cold water. Student classic. No shame.'],
     ['dami_codes', 'Fried rice made with leftover rice and whatever vegetables are left at the end of the week.']], false],
  ['music-movies', 'ronke_reads', 'Best Nollywood film you watched this year?',
    'I am building a watchlist for the holidays. Drop your favourite and one sentence on why, no spoilers please.',
    [['amaka_writes', 'Anything with a tight script and under two hours gets my vote. Too many films drag.'],
     ['tundeonthemic', 'The cinematography has improved so much. Even the smaller productions look good now.']], false],
  ['jobs-careers', 'amaka_writes', 'Your best interview tip in one line',
    'I have three interviews next week and I am nervous. Give me your single best tip.',
    [['chidi_analyst', 'Research the company enough to ask one smart question at the end.'],
     ['bayo_builds', 'Say "I don\'t know, but here is how I would find out" instead of bluffing.'],
     ['zainab_k', 'Arrive early, find the bathroom, breathe.'],
     ['ngozi_travels', 'Have a short story ready for "tell me about a challenge you faced".']], true],
  ['phones-gadgets', 'dami_codes', 'Is it worth buying a refurbished phone?',
    'Thinking of getting a refurbished flagship instead of a new mid-range phone. Same price range.\n\nAnyone had good or bad experiences?',
    [['musa_motors', 'Check the battery health before paying. That is where they hide the problems.'],
     ['efe_waffi', 'Buy from a shop that gives at least a 3-month warranty. Never from someone on the roadside.']], false],
  ['cars-motoring', 'musa_motors', 'Ask a mechanic: post your car problems here',
    'I will try to answer when I can. Tell me the car, the year, and what you hear or see. Pictures help.',
    [['chidi_analyst', '2011 sedan, the AC blows warm air after about 20 minutes of driving. Any ideas?'],
     ['musa_motors', '[quote author=chidi_analyst]the AC blows warm air after about 20 minutes[/quote]\nCould be low gas or the cooling fan not kicking in. Check the fan first, it is cheaper.']], false],
  ['politics-governance', 'tundeonthemic', 'What one policy change would make the biggest difference in your area?',
    'Not party politics, just practical stuff. If you could change one thing in your local government area, what would it be?',
    [['zainab_k', 'Working streetlights. Safety and small businesses at night would improve straight away.'],
     ['musa_motors', 'Fix the drainage before the rains. Every year the same flooding.'],
     ['amaka_writes', 'Proper public libraries with steady power. Students need somewhere to read.']], true],
  ['relationships', 'amaka_writes', 'How do you split bills in a relationship?',
    'Fifty-fifty, by income, or one person covers everything? Curious what works for people here.',
    [['efe_waffi', 'By income. Fifty-fifty is not fair if one person earns three times more.'],
     ['ronke_reads', 'Whatever you agree on, talk about it early. Money fights are the worst fights.']], false],
  ['schools-exams', 'ronke_reads', 'Study timetable tips for exam season',
    'Final year students, how are you planning your revision? Share timetables that actually worked.',
    [['bayo_builds', 'Short sessions with breaks. 45 minutes on, 10 off.'],
     ['zainab_k', 'Past questions, past questions, past questions.']], false],
  ['health-matters', 'zainab_k', 'Pharmacist here: questions about common medicines',
    'General information only, not a replacement for seeing a doctor. Ask about common over-the-counter medicines and I will try to help.',
    [['tundeonthemic', 'Is it okay to take painkillers on an empty stomach?'],
     ['zainab_k', '@tundeonthemic some are fine, others can irritate the stomach. Check the leaflet, and when in doubt, eat something small first.']], false],
  ['gisthall-feedback', 'hallkeeper', 'Welcome to Gisthall: read this first',
    'Welcome! A few quick things:\n\n- Post in the right board so people can find your topic.\n- Use Quote to reply to a specific post, and @username to mention someone.\n- Follow members, boards or topics to get alerts.\n- Use Report instead of fighting. The moderators will handle it.\n\nHouse rules are linked at the bottom of every page.',
    [['dami_codes', 'Clean design. Dark mode when?'],
     ['hallkeeper', '@dami_codes it follows your device setting already. Try switching your phone to dark mode.']], true],
  ['jokes-banter', 'efe_waffi', 'Things only Nigerians say',
    'I will start: "I am on my way" when you have not even taken your bath.',
    [['tundeonthemic', '"Let me come" and then you never see them again.'],
     ['amaka_writes', '"Take something small" before the host serves you a full plate.'],
     ['dami_codes', '"Is it not you that I am talking to?"']], true],
  ['properties-rent', 'chidi_analyst', 'Red flags when renting an apartment',
    'Share the warning signs. Mine: an agent who refuses to let you meet the landlord.',
    [['ngozi_travels', 'Agreement and caution fees that keep changing every time you ask.'],
     ['bayo_builds', 'Freshly painted walls in only one room. Check for damp.']], false],
  ['market-square', 'musa_motors', 'Selling: used car tools set (Kaduna)',
    'Complete socket set and two jacks. Pickup in Kaduna. Message me with offers. No "pay first" requests, inspect before you pay.',
    [['efe_waffi', 'Good of you to add that warning. Too many scams in these parts.']], false],
];

export function seed(db) {
  const forum = createForum(db, { floodSeconds: 0 });
  return tx(db, () => {
    const boardSlugs = {};
    for (const [section, boards] of SECTIONS) {
      const sectionId = forum.createSection(section);
      for (const [name, description] of boards) {
        const id = forum.createBoard({ sectionId, name, description });
        boardSlugs[name] = db.prepare('SELECT slug FROM boards WHERE id = ?').get(id).slug;
      }
    }

    const users = {};
    const admin = forum.register({ username: DEMO_ADMIN.username, email: 'hallkeeper@gisthall.example', password: DEMO_ADMIN.password, role: 'admin', allowReserved: true });
    forum.updateProfile(admin.id, { bio: 'Keeping the lights on at Gisthall.', location: 'Lagos', signature: 'Read the house rules.' });
    users.hallkeeper = admin;
    for (const [username, location, gender, bio] of MEMBERS) {
      const u = forum.register({ username, email: `${username}@gisthall.example`, password: DEMO_PASSWORD });
      forum.updateProfile(u.id, { bio, location, gender });
      users[username] = u;
    }
    forum.setBoardMod(admin, 'tech-corner', 'bayo_builds', true);
    forum.setBoardMod(admin, 'football', 'efe_waffi', true);

    const fresh = (name) => forum.getUserById(users[name].id);
    let minutesAgo = THREADS.length * 90 + 60;
    let topics = 0;
    for (const [board, author, title, body, replies, featured] of THREADS) {
      const { topicId, postId } = forum.createTopic(fresh(author), board, { title, body });
      let ts = minutesAgo;
      db.prepare(`UPDATE posts SET created_at = datetime('now', ?) WHERE id = ?`).run(`-${ts} minutes`, postId);
      db.prepare(`UPDATE topics SET created_at = datetime('now', ?), last_post_at = datetime('now', ?) WHERE id = ?`).run(`-${ts} minutes`, `-${ts} minutes`, topicId);
      const postIds = [postId];
      for (const [replier, text] of replies) {
        // Resolve quote tags written with author names to real post ids.
        const resolved = text.replace(/\[quote author=(\w+)\]/g, (m, a) => {
          const quoted = db.prepare('SELECT p.id FROM posts p JOIN users u ON u.id = p.user_id WHERE p.topic_id = ? AND u.username = ? ORDER BY p.id DESC LIMIT 1').get(topicId, a);
          return quoted ? `[quote author=${a} post=${quoted.id}]` : m;
        });
        const rid = forum.reply(fresh(replier), topicId, resolved);
        ts -= 25 + (rid % 7) * 5;
        const when = `-${Math.max(ts, 1)} minutes`;
        db.prepare(`UPDATE posts SET created_at = ? WHERE id = ?`).run(db.prepare(`SELECT datetime('now', ?) AS t`).get(when).t, rid);
        db.prepare(`UPDATE topics SET last_post_at = datetime('now', ?) WHERE id = ?`).run(when, topicId);
        postIds.push(rid);
      }
      // A few likes so counters are not all zero.
      const likers = Object.keys(users).filter((n) => n !== author).slice(0, (topicId % 5) + 1);
      for (const n of likers) forum.toggleLike(fresh(n), postIds[0]);
      db.prepare('UPDATE topics SET views = ? WHERE id = ?').run(40 + ((topicId * 37) % 400), topicId);
      if (featured) forum.setTopicFlag(admin, topicId, 'featured', true);
      minutesAgo -= 90;
      topics++;
    }
    // Pin the welcome topic.
    const welcome = db.prepare(`SELECT id FROM topics WHERE title LIKE 'Welcome to Gisthall%'`).get();
    forum.setTopicFlag(admin, welcome.id, 'sticky', true);
    // Seeded activity should not count as unread alerts or a live "online" list.
    db.exec(`UPDATE notifications SET read_at = datetime('now'); UPDATE users SET last_seen = datetime('now', '-2 hours'); DELETE FROM mod_log;`);
    return { users: Object.keys(users).length, topics, admin: DEMO_ADMIN, boards: boardSlugs };
  });
}
