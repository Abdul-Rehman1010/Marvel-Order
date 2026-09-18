export type Universe = "mcu" | "xmen" | "street";
export type ContentKind = "movie" | "series" | "special";

export type Episode = {
  id: number;
  title: string;
  runtimeSec: number;
};

export type ContentItem = {
  id: string;
  title: string;
  year: number;
  releaseDate: string;
  universe: Universe;
  kind: ContentKind;
  required: boolean;
  runtimeSec: number;
  phase: string;
  wikiTitle: string;
  summary: string;
  lore: string;
  episodes?: Episode[];
  recommendation?: string;
  dataPending?: boolean;
};

const minutes = (value: number) => value * 60;

function episodes(
  runtimes: number[],
  titles: string[] = [],
): Episode[] {
  return runtimes.map((runtime, index) => ({
    id: index + 1,
    title: titles[index] ?? `Episode ${index + 1}`,
    runtimeSec: minutes(runtime),
  }));
}

function movie(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  phase: string,
  wikiTitle = `${title} (film)`,
  summary = "A pivotal chapter in the Marvel Cinematic Universe.",
  lore = "Its release position preserves the intended character reveals, alliances, and post-credit continuity.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "mcu",
    kind: "movie",
    required: true,
    runtimeSec: minutes(runtime),
    phase,
    wikiTitle,
    summary,
    lore,
  };
}

function series(
  id: string,
  title: string,
  releaseDate: string,
  runtimes: number[],
  required: boolean,
  phase: string,
  options: Partial<ContentItem> & { episodeTitles?: string[] } = {},
): ContentItem {
  const episodeList = episodes(runtimes, options.episodeTitles);
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: options.universe ?? "mcu",
    kind: "series",
    required,
    runtimeSec: episodeList.reduce((total, episode) => total + episode.runtimeSec, 0),
    phase,
    wikiTitle: options.wikiTitle ?? `${title} (TV series)`,
    summary: options.summary ?? "A Marvel Studios series expanding the characters and consequences of the cinematic timeline.",
    lore: options.lore ?? "Placed by premiere date so its reveals land in the same order audiences originally encountered them.",
    episodes: episodeList,
    recommendation: options.recommendation,
    dataPending: options.dataPending,
  };
}

function special(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  phase: string,
  wikiTitle = title,
  summary = "A self-contained Marvel Studios special presentation.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "mcu",
    kind: "special",
    required: false,
    runtimeSec: minutes(runtime),
    phase,
    wikiTitle,
    summary,
    lore: "Optional side transmission: it enriches the universe but does not gate the primary road to Doomsday.",
  };
}

const mcu: ContentItem[] = [
  movie("iron-man", "Iron Man", "2008-05-02", 126, "Phase One", "Iron Man (2008 film)", "Tony Stark transforms captivity and guilt into the first modern armored hero.", "The launch point of the MCU: it establishes Stark technology, S.H.I.E.L.D., and the promise of the Avengers Initiative."),
  movie("incredible-hulk", "The Incredible Hulk", "2008-06-13", 112, "Phase One", "The Incredible Hulk (film)"),
  movie("iron-man-2", "Iron Man 2", "2010-05-07", 124, "Phase One", "Iron Man 2"),
  movie("thor", "Thor", "2011-05-06", 115, "Phase One", "Thor (film)"),
  movie("captain-america-first-avenger", "Captain America: The First Avenger", "2011-07-22", 124, "Phase One", "Captain America: The First Avenger"),
  movie("avengers", "The Avengers", "2012-05-04", 143, "Phase One", "The Avengers (2012 film)", "Earth's emerging heroes unite against a threat no single champion can stop.", "Pays off every Phase One introduction; watching it early would expose the team, the Tesseract, and several character outcomes."),
  movie("iron-man-3", "Iron Man 3", "2013-05-03", 130, "Phase Two", "Iron Man 3"),
  movie("thor-dark-world", "Thor: The Dark World", "2013-11-08", 112, "Phase Two", "Thor: The Dark World"),
  movie("winter-soldier", "Captain America: The Winter Soldier", "2014-04-04", 136, "Phase Two", "Captain America: The Winter Soldier"),
  movie("guardians-1", "Guardians of the Galaxy", "2014-08-01", 121, "Phase Two", "Guardians of the Galaxy (film)"),
  movie("age-of-ultron", "Avengers: Age of Ultron", "2015-05-01", 141, "Phase Two", "Avengers: Age of Ultron"),
  movie("ant-man", "Ant-Man", "2015-07-17", 117, "Phase Two", "Ant-Man (film)"),
  movie("civil-war", "Captain America: Civil War", "2016-05-06", 147, "Phase Three", "Captain America: Civil War"),
  movie("doctor-strange", "Doctor Strange", "2016-11-04", 115, "Phase Three", "Doctor Strange (2016 film)", "A brilliant surgeon discovers the mystic arts and a reality beyond conventional science.", "Introduces sorcery, the Masters of the Mystic Arts, and rules that later multiverse stories build upon."),
  movie("guardians-2", "Guardians of the Galaxy Vol. 2", "2017-05-05", 137, "Phase Three", "Guardians of the Galaxy Vol. 2"),
  movie("spider-man-homecoming", "Spider-Man: Homecoming", "2017-07-07", 133, "Phase Three", "Spider-Man: Homecoming"),
  movie("thor-ragnarok", "Thor: Ragnarok", "2017-11-03", 130, "Phase Three", "Thor: Ragnarok"),
  movie("black-panther", "Black Panther", "2018-02-16", 134, "Phase Three", "Black Panther (film)"),
  movie("infinity-war", "Avengers: Infinity War", "2018-04-27", 149, "Phase Three", "Avengers: Infinity War"),
  movie("ant-man-wasp", "Ant-Man and the Wasp", "2018-07-06", 118, "Phase Three", "Ant-Man and the Wasp"),
  movie("captain-marvel", "Captain Marvel", "2019-03-08", 123, "Phase Three", "Captain Marvel (film)"),
  movie("endgame", "Avengers: Endgame", "2019-04-26", 181, "Phase Three", "Avengers: Endgame"),
  movie("far-from-home", "Spider-Man: Far From Home", "2019-07-02", 129, "Phase Three", "Spider-Man: Far From Home"),
  series("wandavision", "WandaVision", "2021-01-15", [30, 37, 33, 35, 42, 38, 38, 47, 50], true, "Phase Four", {
    wikiTitle: "WandaVision",
    summary: "Wanda and Vision inhabit a reality that shifts through television history while grief presses against its edges.",
    lore: "Required before Multiverse of Madness: it establishes Wanda's grief, power evolution, and the Darkhold thread.",
    episodeTitles: ["Filmed Before a Live Studio Audience", "Don't Touch That Dial", "Now in Color", "We Interrupt This Program", "On a Very Special Episode…", "All-New Halloween Spooktacular!", "Breaking the Fourth Wall", "Previously On", "The Series Finale"],
  }),
  series("falcon-winter-soldier", "The Falcon and the Winter Soldier", "2021-03-19", [50, 49, 53, 51, 60, 53], true, "Phase Four", {
    wikiTitle: "The Falcon and the Winter Soldier",
    lore: "Required before Brave New World: it resolves the ownership and meaning of Captain America's shield.",
    episodeTitles: ["New World Order", "The Star-Spangled Man", "Power Broker", "The Whole World Is Watching", "Truth", "One World, One People"],
  }),
  series("loki-1", "Loki — Season 1", "2021-06-09", [51, 54, 42, 48, 51, 46], true, "Phase Four", {
    wikiTitle: "Loki season 1",
    lore: "The foundation of the TVA and branching-timeline logic that drives the Multiverse Saga.",
    episodeTitles: ["Glorious Purpose", "The Variant", "Lamentis", "The Nexus Event", "Journey into Mystery", "For All Time. Always."],
  }),
  movie("black-widow", "Black Widow", "2021-07-09", 134, "Phase Four", "Black Widow (2021 film)"),
  series("what-if-1", "What If…? — Season 1", "2021-08-11", [34, 32, 32, 36, 33, 34, 32, 31, 36], false, "Phase Four", {
    wikiTitle: "What If...? season 1",
    lore: "Optional multiverse anthology positioned after Loki opens the door to branching realities.",
  }),
  movie("shang-chi", "Shang-Chi and the Legend of the Ten Rings", "2021-09-03", 132, "Phase Four", "Shang-Chi and the Legend of the Ten Rings"),
  { ...movie("eternals", "Eternals", "2021-11-05", 156, "Phase Four", "Eternals (film)"), required: false, lore: "Optional cosmic history: it expands the MCU's ancient mythology but does not gate the required road to Doomsday." },
  movie("no-way-home", "Spider-Man: No Way Home", "2021-12-17", 148, "Phase Four", "Spider-Man: No Way Home"),
  series("moon-knight", "Moon Knight", "2022-03-30", [47, 53, 51, 51, 47, 44], false, "Phase Four", {
    wikiTitle: "Moon Knight (miniseries)",
    recommendation: "Developer's recommendation: optional, but highly recommended because this show is absolutely GOATED.",
    episodeTitles: ["The Goldfish Problem", "Summon the Suit", "The Friendly Type", "The Tomb", "Asylum", "Gods and Monsters"],
  }),
  movie("multiverse-of-madness", "Doctor Strange in the Multiverse of Madness", "2022-05-06", 126, "Phase Four", "Doctor Strange in the Multiverse of Madness", "Doctor Strange crosses unstable realities when a new traveler's power attracts a relentless threat.", "Requires X-Men (2000) to establish Charles Xavier, the mutant team, and the legacy continuity before the MCU directly engages with alternate Marvel universes."),
  series("ms-marvel", "Ms. Marvel", "2022-06-08", [50, 50, 47, 47, 45, 50], true, "Phase Four", {
    wikiTitle: "Ms. Marvel (miniseries)",
    lore: "Required before The Marvels: introduces Kamala Khan, her family, and the origin of her cosmic connection.",
    episodeTitles: ["Generation Why", "Crushed", "Destined", "Seeing Red", "Time and Again", "No Normal"],
  }),
  movie("love-and-thunder", "Thor: Love and Thunder", "2022-07-08", 119, "Phase Four", "Thor: Love and Thunder"),
  series("i-am-groot-1", "I Am Groot — Season 1", "2022-08-10", [5, 5, 5, 5, 5], false, "Phase Four", {
    wikiTitle: "I Am Groot",
    episodeTitles: ["Groot's First Steps", "The Little Guy", "Groot's Pursuit", "Groot Takes a Bath", "Magnum Opus"],
  }),
  series("she-hulk", "She-Hulk: Attorney at Law", "2022-08-18", [38, 30, 31, 35, 31, 35, 34, 36, 38], false, "Phase Four", { wikiTitle: "She-Hulk: Attorney at Law" }),
  special("werewolf-by-night", "Werewolf by Night", "2022-10-07", 53, "Phase Four", "Werewolf by Night (TV special)"),
  movie("wakanda-forever", "Black Panther: Wakanda Forever", "2022-11-11", 161, "Phase Four", "Black Panther: Wakanda Forever"),
  special("guardians-holiday", "The Guardians of the Galaxy Holiday Special", "2022-11-25", 44, "Phase Four", "The Guardians of the Galaxy Holiday Special"),
  movie("quantumania", "Ant-Man and the Wasp: Quantumania", "2023-02-17", 125, "Phase Five", "Ant-Man and the Wasp: Quantumania"),
  movie("guardians-3", "Guardians of the Galaxy Vol. 3", "2023-05-05", 150, "Phase Five", "Guardians of the Galaxy Vol. 3"),
  series("secret-invasion", "Secret Invasion", "2023-06-21", [55, 58, 43, 38, 38, 38], true, "Phase Five", {
    wikiTitle: "Secret Invasion (miniseries)",
    episodeTitles: ["Resurrection", "Promises", "Betrayed", "Beloved", "Harvest", "Home"],
  }),
  series("i-am-groot-2", "I Am Groot — Season 2", "2023-09-06", [5, 5, 5, 5, 5], false, "Phase Five", {
    wikiTitle: "I Am Groot",
    episodeTitles: ["Are You My Groot?", "Groot Noses Around", "Groot's Snow Day", "Groot's Sweet Treat", "Groot and the Great Prophecy"],
  }),
  series("loki-2", "Loki — Season 2", "2023-10-05", [47, 50, 55, 49, 56, 59], true, "Phase Five", {
    wikiTitle: "Loki season 2",
    lore: "Completes the TVA's transformation and defines the structure protecting the wider multiverse.",
    episodeTitles: ["Ouroboros", "Breaking Brad", "1893", "Heart of the TVA", "Science/Fiction", "Glorious Purpose"],
  }),
  movie("the-marvels", "The Marvels", "2023-11-10", 105, "Phase Five", "The Marvels"),
  series("what-if-2", "What If…? — Season 2", "2023-12-22", [33, 31, 29, 31, 32, 31, 30, 31, 34], false, "Phase Five", { wikiTitle: "What If...? season 2" }),
  series("agatha", "Agatha All Along", "2024-09-18", [40, 44, 39, 44, 49, 50, 37, 49, 43], true, "Phase Five", {
    wikiTitle: "Agatha All Along (miniseries)",
    lore: "Continues the magical consequences of WandaVision and expands the rules surrounding witches and power.",
  }),
  series("what-if-3", "What If…? — Season 3", "2024-12-22", [32, 31, 33, 31, 34, 32, 31, 36], false, "Phase Five", { wikiTitle: "What If...? season 3" }),
  series("friendly-spider-man-1", "Your Friendly Neighborhood Spider-Man — Season 1", "2025-01-29", [32, 31, 30, 31, 32, 30, 31, 32, 31, 34], false, "Phase Five", { wikiTitle: "Your Friendly Neighborhood Spider-Man" }),
  movie("brave-new-world", "Captain America: Brave New World", "2025-02-14", 118, "Phase Five", "Captain America: Brave New World"),
  movie("thunderbolts", "Thunderbolts*", "2025-05-02", 127, "Phase Five", "Thunderbolts*"),
  series("ironheart", "Ironheart", "2025-06-24", [48, 50, 45, 47, 50, 54], false, "Phase Five", { wikiTitle: "Ironheart (miniseries)" }),
  movie("fantastic-four-first-steps", "The Fantastic Four: First Steps", "2025-07-25", 115, "Phase Six", "The Fantastic Four: First Steps"),
  series("eyes-of-wakanda", "Eyes of Wakanda", "2025-08-01", [31, 28, 30, 32], false, "Phase Six", { wikiTitle: "Eyes of Wakanda" }),
  series("marvel-zombies", "Marvel Zombies", "2025-09-24", [33, 35, 36, 38], false, "Phase Six", { wikiTitle: "Marvel Zombies (TV series)" }),
  series("wonder-man", "Wonder Man", "2026-01-27", [35, 36, 33, 38, 40, 37, 41, 44], false, "Phase Six", { wikiTitle: "Wonder Man (miniseries)" }),
  movie("brand-new-day", "Spider-Man: Brand New Day", "2026-07-31", 136, "Phase Six", "Spider-Man: Brand New Day"),
  series("visionquest", "VisionQuest", "2026-10-14", [0, 0, 0, 0, 0, 0, 0, 0], true, "Phase Six", {
    wikiTitle: "VisionQuest (miniseries)",
    summary: "Vision's story continues in the final chapter of the trilogy begun by WandaVision.",
    lore: "Scheduled before Doomsday and therefore retained as the final required transmission. Episode runtimes will activate when officially published.",
    dataPending: true,
  }),
  series("friendly-spider-man-2", "Your Friendly Neighborhood Spider-Man — Season 2", "2026-11-01", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], false, "Phase Six", {
    wikiTitle: "Your Friendly Neighborhood Spider-Man season 2",
    dataPending: true,
  }),
];

function streetSeries(
  id: string,
  title: string,
  releaseDate: string,
  runtimes: number[],
  episodeTitles: string[],
  summary: string,
  lore = "Kept in release order so character introductions, alliances, and the New York underworld develop without spoilers.",
): ContentItem {
  return series(id, title, releaseDate, runtimes, true, "Street-Level Saga", {
    universe: "street",
    wikiTitle: title,
    episodeTitles,
    summary,
    lore,
  });
}

const street: ContentItem[] = [
  streetSeries(
    "defenders-daredevil-1",
    "Daredevil — Season 1",
    "2015-04-10",
    [60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60],
    ["Into the Ring", "Cut Man", "Rabbit in a Snowstorm", "In the Blood", "World on Fire", "Condemned", "Stick", "Shadows in the Glass", "Speak of the Devil", "Nelson v. Murdock", "The Path of the Righteous", "The Ones We Leave Behind", "Daredevil"],
    "Blind lawyer Matt Murdock uses his heightened senses to challenge the criminal forces tightening their grip on Hell's Kitchen.",
  ),
  streetSeries(
    "defenders-jessica-jones-1",
    "Jessica Jones — Season 1",
    "2015-11-20",
    [52, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60],
    ["AKA Ladies Night", "AKA Crush Syndrome", "AKA It's Called Whiskey", "AKA 99 Friends", "AKA The Sandwich Saved Me", "AKA You're a Winner!", "AKA Top Shelf Perverts", "AKA WWJD?", "AKA Sin Bin", "AKA 1,000 Cuts", "AKA I've Got the Blues", "AKA Take a Bloody Number", "AKA Smile"],
    "Private investigator Jessica Jones takes a case that forces her to confront a manipulative figure from her past.",
  ),
  streetSeries(
    "defenders-daredevil-2",
    "Daredevil — Season 2",
    "2016-03-18",
    [48, 50, 48, 60, 56, 56, 56, 54, 59, 60, 55, 52, 57],
    ["Bang", "Dogs to a Gunfight", "New York's Finest", "Penny and Dime", "Kinbaku", "Regrets Only", "Semper Fidelis", "Guilty as Sin", "Seven Minutes in Heaven", "The Man in the Box", ".380", "The Dark at the End of the Tunnel", "A Cold Day in Hell's Kitchen"],
    "Daredevil's methods are challenged by a lethal vigilante and the return of a dangerous connection from Matt's past.",
  ),
  streetSeries(
    "defenders-luke-cage-1",
    "Luke Cage — Season 1",
    "2016-09-30",
    [54, 60, 56, 60, 60, 60, 60, 60, 60, 60, 60, 61, 45],
    ["Moment of Truth", "Code of the Streets", "Who's Gonna Take the Weight?", "Step in the Arena", "Just to Get a Rep", "Suckas Need Bodyguards", "Manifest", "Blowin' Up the Spot", "DWYCK", "Take It Personal", "Now You're Mine", "Soliloquy of Chaos", "You Know My Steez"],
    "A reluctant hero with unbreakable skin steps forward when crime and corruption threaten his Harlem community.",
  ),
  streetSeries(
    "defenders-iron-fist-1",
    "Iron Fist — Season 1",
    "2017-03-17",
    [57, 61, 59, 54, 56, 53, 58, 55, 54, 56, 52, 50, 53],
    ["Snow Gives Way", "Shadow Hawk Takes Flight", "Rolling Thunder Cannon Punch", "Eight Diagram Dragon Palm", "Under Leaf Pluck Lotus", "Immortal Emerges from Cave", "Felling Tree with Roots", "The Blessing of Many Fractures", "The Mistress of All Agonies", "Black Tiger Steals Heart", "Lead Horse Back to Stable", "Bar the Big Boss", "Dragon Plays with Fire"],
    "Danny Rand returns to New York after years away, carrying a mystical power and questions about his family's company.",
  ),
  streetSeries(
    "defenders-the-defenders",
    "The Defenders",
    "2017-08-18",
    [52, 45, 55, 45, 51, 51, 46, 56],
    ["The H Word", "Mean Right Hook", "Worst Behavior", "Royal Dragon", "Take Shelter", "Ashes, Ashes", "Fish in the Jailhouse", "The Defenders"],
    "Daredevil, Jessica Jones, Luke Cage, and Iron Fist are drawn together by a conspiracy threatening New York.",
    "The crossover pays off the four preceding hero introductions and must remain after their first seasons.",
  ),
  streetSeries(
    "defenders-punisher-1",
    "The Punisher — Season 1",
    "2017-11-17",
    [60, 60, 60, 60, 60, 60, 49, 53, 54, 49, 52, 51, 55],
    ["3AM", "Two Dead Men", "Kandahar", "Resupply", "Gunner", "The Judas Goat", "Crosshairs", "Cold Steel", "Front Toward Enemy", "Virtue of the Vicious", "Danger Close", "Home", "Memento Mori"],
    "Frank Castle uncovers a conspiracy connected to his military service while pursuing his own uncompromising form of justice.",
  ),
  streetSeries(
    "defenders-jessica-jones-2",
    "Jessica Jones — Season 2",
    "2018-03-08",
    [54, 56, 54, 50, 52, 49, 54, 50, 50, 55, 49, 47, 53],
    ["AKA Start at the Beginning", "AKA Freak Accident", "AKA Sole Survivor", "AKA God Help the Hobo", "AKA The Octopus", "AKA Facetime", "AKA I Want Your Cray Cray", "AKA Ain't We Got Fun", "AKA Shark in the Bathtub, Monster in the Bed", "AKA Pork Chop", "AKA Three Lives and Counting", "AKA Pray for My Patsy", "AKA Playland"],
    "Jessica investigates the origins of her abilities as new evidence reopens questions she thought were buried.",
  ),
  streetSeries(
    "defenders-luke-cage-2",
    "Luke Cage — Season 2",
    "2018-06-22",
    [56, 55, 60, 55, 58, 64, 56, 55, 59, 59, 56, 62, 69],
    ["Soul Brother #1", "Straighten It Out", "Wig Out", "I Get Physical", "All Souled Out", "The Basement", "On and On", "If It Ain't Rough, It Ain't Right", "For Pete's Sake", "The Main Ingredient", "The Creator", "Can't Front on Me", "They Reminisce Over You"],
    "Luke's growing reputation as Harlem's protector is tested by a powerful newcomer and the neighborhood's competing factions.",
  ),
  streetSeries(
    "defenders-iron-fist-2",
    "Iron Fist — Season 2",
    "2018-09-07",
    [57, 53, 52, 53, 55, 51, 54, 49, 50, 52],
    ["The Fury of Iron Fist", "The City's Not for Burning", "This Deadly Secret...", "Target: Iron Fist", "Heart of the Dragon", "The Dragon Dies at Dawn", "Morning of the Mindstorm", "Citadel on the Edge of Vengeance", "War Without End", "A Duel of Iron"],
    "Danny tries to protect lower Manhattan while a conflict over the power of the Iron Fist moves dangerously close to home.",
  ),
  streetSeries(
    "defenders-daredevil-3",
    "Daredevil — Season 3",
    "2018-10-19",
    [53, 50, 50, 54, 49, 54, 50, 50, 54, 46, 50, 55, 54],
    ["Resurrection", "Please", "No Good Deed", "Blindsided", "The Perfect Game", "The Devil You Know", "Aftermath", "Upstairs/Downstairs", "Revelations", "Karen", "Reunion", "One Last Shot", "A New Napkin"],
    "Matt Murdock returns to a changed Hell's Kitchen as Wilson Fisk rebuilds his influence through a calculated new strategy.",
  ),
  streetSeries(
    "defenders-punisher-2",
    "The Punisher — Season 2",
    "2019-01-18",
    [53, 55, 51, 57, 51, 56, 52, 48, 58, 47, 55, 50, 57],
    ["Roadhouse Blues", "Fight or Flight", "Trouble the Water", "Scar Tissue", "One-Eyed Jacks", "Nakazat", "One Bad Day", "My Brother's Keeper", "Flustercluck", "The Dark Hearts of Men", "The Abyss", "Collision Course", "The Whirlwind"],
    "Frank Castle is pulled into protecting a young woman while unfinished business from his past resurfaces.",
  ),
  streetSeries(
    "defenders-jessica-jones-3",
    "Jessica Jones — Season 3",
    "2019-06-14",
    [52, 55, 56, 46, 53, 53, 51, 44, 52, 50, 48, 49, 51],
    ["A.K.A The Perfect Burger", "A.K.A You're Welcome", "A.K.A I Have No Spleen", "A.K.A Customer Service is Standing By", "A.K.A I Wish", "A.K.A Sorry Face", "A.K.A The Double Half-Wappinger", "A.K.A Camera Friendly", "A.K.A I Did Something Today", "A.K.A Hero Pants", "A.K.A Hellcat", "A.K.A A Lotta Worms", "A.K.A Everything"],
    "Jessica confronts a calculating adversary while a changing partnership forces difficult questions about heroism.",
  ),
  streetSeries(
    "hawkeye",
    "Hawkeye",
    "2021-11-24",
    [49, 51, 44, 42, 46, 61],
    ["Never Meet Your Heroes", "Hide and Seek", "Echoes", "Partners, Am I Right?", "Ronin", "So This Is Christmas?"],
    "Clint Barton teams with skilled young archer Kate Bishop when a threat connected to his past disrupts Christmas in New York.",
    "Requires Avengers: Endgame before entry. It then bridges the Avengers' street-level consequences into Echo and the renewed Daredevil story.",
  ),
  streetSeries(
    "echo",
    "Echo",
    "2024-01-09",
    [51, 39, 42, 37, 34],
    ["Chafa", "Lowak", "Tuklo", "Taloa", "Maya"],
    "Maya Lopez returns to her Oklahoma hometown, where she must confront her past, family, and connection to a criminal empire.",
    "Continues Maya Lopez's story directly after Hawkeye and reconnects the modern street-level timeline to Wilson Fisk.",
  ),
  streetSeries(
    "born-again-1",
    "Daredevil: Born Again — Season 1",
    "2025-03-04",
    [59, 49, 45, 48, 52, 49, 48, 51, 58],
    ["Heaven's Half Hour", "Optics", "The Hollow of His Hand", "Sic Semper Systema", "With Interest", "Excessive Force", "Art for Art's Sake", "Isle of Joy", "Straight to Hell"],
    "Matt Murdock pursues justice through his law firm while Wilson Fisk begins a powerful new chapter in New York politics.",
    "Follows the Defenders-era Daredevil story and the Fisk threads carried through Hawkeye and Echo.",
  ),
  streetSeries(
    "born-again-2",
    "Daredevil: Born Again — Season 2",
    "2026-03-24",
    [51, 54, 49, 50, 52, 48, 53, 58],
    ["Episode 1", "Episode 2", "Episode 3", "Episode 4", "Episode 5", "Episode 6", "Episode 7", "Episode 8"],
    "Matt Murdock's fight for New York continues as the conflict surrounding Wilson Fisk reaches a new phase.",
    "The next required chapter of the street-level saga. Episode titles and final runtimes will be updated when officially published.",
  ),
  {
    ...special("punisher-one-last-kill", "The Punisher: One Last Kill", "2026-05-12", 52, "Street-Level Saga", "The Punisher: One Last Kill", "Frank Castle returns for a standalone special connected to Marvel's modern street-level story."),
    universe: "street",
    required: true,
    lore: "Positioned after Daredevil: Born Again Season 2 so its returning characters and New York context arrive in release order.",
  },
];

function xmenMovie(
  id: string,
  title: string,
  releaseDate: string,
  runtime: number,
  required = true,
  wikiTitle = `${title} (film)`,
  lore = "Preserves the release-order evolution of the Fox mutant continuity without forcing optional detours.",
): ContentItem {
  return {
    id,
    title,
    year: Number(releaseDate.slice(0, 4)),
    releaseDate,
    universe: "xmen",
    kind: "movie",
    required,
    runtimeSec: minutes(runtime),
    phase: "Fox Mutant Timeline",
    wikiTitle,
    summary: "A chapter of the legacy X-Men film universe that feeds the wider multiverse context.",
    lore,
  };
}

const xmen: ContentItem[] = [
  xmenMovie("xmen-2000", "X-Men", "2000-07-14", 104, true, "X-Men (film)", "The essential mutant foundation: introduces Charles Xavier, Magneto, the X-Men, and the ideological conflict later echoed across the multiverse."),
  xmenMovie("x2", "X2: X-Men United", "2003-05-02", 134, true, "X2 (film)"),
  xmenMovie("last-stand", "X-Men: The Last Stand", "2006-05-26", 104, true, "X-Men: The Last Stand"),
  xmenMovie("origins-wolverine", "X-Men Origins: Wolverine", "2009-05-01", 107, true, "X-Men Origins: Wolverine"),
  xmenMovie("first-class", "X-Men: First Class", "2011-06-03", 132, true, "X-Men: First Class"),
  xmenMovie("the-wolverine", "The Wolverine", "2013-07-26", 126, true, "The Wolverine (film)"),
  xmenMovie("days-future-past", "X-Men: Days of Future Past", "2014-05-23", 132, true, "X-Men: Days of Future Past"),
  xmenMovie("deadpool", "Deadpool", "2016-02-12", 108, true, "Deadpool (film)", "Requires X-Men (2000) to establish the legacy mutant universe before Wade Wilson's story begins."),
  xmenMovie("apocalypse", "X-Men: Apocalypse", "2016-05-27", 144, false, "X-Men: Apocalypse", "Optional branch: shown in release position but not required for the Doomsday-ready path."),
  xmenMovie("logan", "Logan", "2017-03-03", 137, true, "Logan (film)"),
  xmenMovie("deadpool-2", "Deadpool 2", "2018-05-18", 119, true, "Deadpool 2", "Requires Deadpool so Wade Wilson's story and supporting characters carry forward in sequence."),
  xmenMovie("dark-phoenix", "Dark Phoenix", "2019-06-07", 114, false, "Dark Phoenix (film)", "Optional branch: visible for completionists but never blocks later required mutant entries."),
  xmenMovie("new-mutants", "The New Mutants", "2020-08-28", 94, false, "The New Mutants (film)", "Optional branch: part of the Fox catalogue, but not required for the core Doomsday context."),
  xmenMovie("deadpool-wolverine", "Deadpool & Wolverine", "2024-07-26", 128, true, "Deadpool & Wolverine", "The final required X-Men checkpoint: complete every earlier required mutant film through Deadpool 2. Optional films remain safe to skip."),
];

const MOVIE_SUMMARIES: Record<string, string> = {
  "iron-man": "Weapons inventor Tony Stark builds a powered suit after captivity forces him to confront the consequences of his work.",
  "incredible-hulk": "Bruce Banner searches for a cure to the condition that unleashes the Hulk while the military closes in.",
  "iron-man-2": "Tony Stark faces government pressure, a rival weapons maker, and a threat tied to his family's past.",
  thor: "An arrogant prince of Asgard is banished to Earth, where he must learn what makes someone worthy of power.",
  "captain-america-first-avenger": "During World War II, Steve Rogers volunteers for an experiment that turns his courage into superhuman strength.",
  avengers: "Nick Fury assembles Earth's emerging heroes when a global threat proves too large for any one champion.",
  "iron-man-3": "Tony Stark confronts a mysterious terrorist campaign while reckoning with anxiety and life beyond the armor.",
  "thor-dark-world": "Thor reunites with Jane Foster when an ancient force awakens and threatens the Nine Realms.",
  "winter-soldier": "Steve Rogers uncovers a conspiracy inside the institution he trusted and faces a formidable figure from the past.",
  "guardians-1": "A group of cosmic outlaws reluctantly bands together around a mysterious orb wanted by a dangerous zealot.",
  "age-of-ultron": "The Avengers' attempt to create a global peacekeeping system produces an intelligence with its own catastrophic plan.",
  "ant-man": "A skilled thief inherits a suit that can shrink its wearer and joins a high-stakes heist to protect its technology.",
  "civil-war": "Political pressure to regulate the Avengers divides the team over accountability, loyalty, and personal responsibility.",
  "doctor-strange": "A brilliant surgeon discovers the mystic arts and a reality far beyond conventional science.",
  "guardians-2": "The Guardians explore the mystery of Peter Quill's parentage while their unruly found family is put to the test.",
  "spider-man-homecoming": "Peter Parker balances school life with neighborhood heroics while trying to prove he belongs among the Avengers.",
  "thor-ragnarok": "Stranded on Sakaar, Thor must escape a gladiatorial contest and race to protect Asgard from an approaching crisis.",
  "black-panther": "T'Challa returns to the hidden nation of Wakanda, where a challenger forces him to examine what kind of king he will be.",
  "infinity-war": "Heroes across Earth and space race to stop Thanos from collecting the six Infinity Stones.",
  "ant-man-wasp": "Scott Lang balances family life with a rescue mission that depends on exploring the unstable Quantum Realm.",
  "captain-marvel": "A cosmic warrior arrives on 1990s Earth and begins questioning the war she serves and the past she cannot remember.",
  endgame: "The surviving Avengers search for one extraordinary chance to answer the devastation left by Thanos.",
  "far-from-home": "Peter Parker's European school trip is interrupted by elemental attacks and a new hero claiming to understand them.",
  "black-widow": "Natasha Romanoff confronts a hidden chapter of her history and reconnects with the people who once posed as her family.",
  "shang-chi": "A quiet San Francisco valet is pulled back into the orbit of his powerful father and the legendary Ten Rings.",
  eternals: "A group of immortal guardians reunites after centuries apart when an ancient enemy returns to Earth.",
  "no-way-home": "With his identity exposed, Peter asks Doctor Strange for help and discovers how dangerous an altered spell can become.",
  "multiverse-of-madness": "Doctor Strange crosses unstable realities when a young traveler's rare power attracts a relentless threat.",
  "love-and-thunder": "Thor's search for inner peace is interrupted by a killer targeting gods and the return of Jane Foster.",
  "wakanda-forever": "Wakanda protects its people and its future while mourning a profound loss and facing pressure from the outside world.",
  quantumania: "Scott Lang and his family are pulled into the Quantum Realm, where they encounter strange civilizations and a powerful ruler.",
  "guardians-3": "A crisis connected to Rocket's past sends the Guardians on an urgent mission to protect one of their own.",
  "the-marvels": "Carol Danvers, Monica Rambeau, and Kamala Khan find their light-based powers mysteriously entangled across space.",
  "deadpool-wolverine": "A TVA disruption throws Deadpool into the orbit of a deeply reluctant Wolverine and a mission spanning realities.",
  "brave-new-world": "Sam Wilson is drawn into an international incident after meeting the newly elected U.S. president, Thaddeus Ross.",
  thunderbolts: "A group of disillusioned operatives is trapped in a deadly setup and forced to work together to survive.",
  "fantastic-four-first-steps": "Marvel's First Family protects a retro-futuristic world when a cosmic visitor brings an impossible warning.",
  "brand-new-day": "Peter Parker begins an independent new chapter as Spider-Man while fresh threats emerge across New York City.",
  "xmen-2000": "Two mutant leaders with opposing visions clash over how their people should coexist with a fearful human world.",
  x2: "An attack on the president triggers a crackdown that forces the X-Men into an uneasy fight for mutant survival.",
  "last-stand": "The discovery of a mutant cure intensifies the conflict over identity, choice, and the future of mutantkind.",
  "origins-wolverine": "Logan's early history leads from a violent brotherhood to the secret program that transforms him into Wolverine.",
  "first-class": "During the Cold War, young Charles Xavier and Erik Lehnsherr assemble the first team of mutants.",
  "the-wolverine": "Logan travels to Japan, where an old obligation draws him into a struggle involving mortality and honor.",
  "days-future-past": "The X-Men fight across two eras to prevent an event that could create a devastating future for mutants and humans.",
  deadpool: "Mercenary Wade Wilson becomes an unpredictable masked antihero while hunting the man responsible for his transformation.",
  apocalypse: "An ancient and immensely powerful mutant awakens, forcing a young generation of X-Men to unite.",
  logan: "An aging Logan cares for Charles Xavier near the border until a young mutant arrives needing protection.",
  "deadpool-2": "Wade forms an unconventional team to protect a young mutant caught between vengeance and a time-traveling soldier.",
  "dark-phoenix": "A mission in space exposes Jean Grey to a cosmic force that tests both her powers and the X-Men's unity.",
  "new-mutants": "Five young mutants held in an isolated facility investigate their abilities and the true nature of their confinement.",
};

for (const item of [...mcu, ...xmen, ...street]) {
  if (item.kind === "movie" && MOVIE_SUMMARIES[item.id]) {
    item.summary = MOVIE_SUMMARIES[item.id];
  }
}

export const CONTENT: ContentItem[] = [...mcu, ...xmen, ...street];
export const MCU_CONTENT = mcu;
export const XMEN_CONTENT = xmen;
export const STREET_CONTENT = street;
export const UNIVERSE_CONTENT: Record<Universe, ContentItem[]> = {
  mcu: MCU_CONTENT,
  xmen: XMEN_CONTENT,
  street: STREET_CONTENT,
};

export const CONTENT_BY_ID = new Map(CONTENT.map((item) => [item.id, item]));

export function progressKey(contentId: string, episode = -1) {
  return `${contentId}:${episode}`;
}

export function itemUnits(item: ContentItem) {
  return item.kind === "series" ? item.episodes?.length ?? 0 : 1;
}

export function itemComplete(item: ContentItem, watched: Set<string>) {
  if (item.kind !== "series") return watched.has(progressKey(item.id));
  return (item.episodes ?? []).every((episode) => watched.has(progressKey(item.id, episode.id)));
}

export function priorRequiredItems(item: ContentItem) {
  if (["deadpool", "deadpool-2"].includes(item.id)) return [];
  const universeItems = UNIVERSE_CONTENT[item.universe];
  const index = universeItems.findIndex((candidate) => candidate.id === item.id);
  return universeItems.slice(0, index).filter((candidate) => candidate.required);
}

export function missingPrerequisite(item: ContentItem, watched: Set<string>) {
  if (item.id === "hawkeye") {
    const endgame = CONTENT_BY_ID.get("endgame");
    if (endgame && !itemComplete(endgame, watched)) return endgame;
  }

  if (item.id === "deadpool") {
    const xmenFirst = CONTENT_BY_ID.get("xmen-2000");
    if (xmenFirst && !itemComplete(xmenFirst, watched)) return xmenFirst;
  }

  if (item.id === "deadpool-2") {
    const deadpool = CONTENT_BY_ID.get("deadpool");
    if (deadpool && !itemComplete(deadpool, watched)) return deadpool;
  }

  const missingPrior = priorRequiredItems(item).find((candidate) => !itemComplete(candidate, watched));
  if (missingPrior) return missingPrior;

  if (item.id === "multiverse-of-madness") {
    const xmenFirst = CONTENT_BY_ID.get("xmen-2000");
    if (xmenFirst && !itemComplete(xmenFirst, watched)) return xmenFirst;
  }

  return null;
}

export function unlockReason(item: ContentItem, watched: Set<string>) {
  if (item.id === "hawkeye") {
    const endgame = CONTENT_BY_ID.get("endgame");
    if (endgame && !itemComplete(endgame, watched)) {
      return "Requires Avengers: Endgame so Clint Barton's situation, the Ronin history, and the post-Blip world are understood without spoilers.";
    }
  }

  if (item.id === "deadpool") {
    const xmenFirst = CONTENT_BY_ID.get("xmen-2000");
    if (xmenFirst && !itemComplete(xmenFirst, watched)) {
      return "Requires X-Men (2000) to establish the legacy mutant universe before Deadpool's story begins.";
    }
  }

  if (item.id === "deadpool-2") {
    const deadpool = CONTENT_BY_ID.get("deadpool");
    if (deadpool && !itemComplete(deadpool, watched)) {
      return "Requires Deadpool so Wade Wilson's story and supporting characters continue in order.";
    }
  }

  const missingPrior = priorRequiredItems(item).find((candidate) => !itemComplete(candidate, watched));
  if (missingPrior) {
    return `Requires ${missingPrior.title} to preserve release-order context and prevent character or event spoilers.`;
  }

  if (item.id === "multiverse-of-madness") {
    const xmenFirst = CONTENT_BY_ID.get("xmen-2000");
    if (xmenFirst && !itemComplete(xmenFirst, watched)) {
      return "Requires X-Men (2000) to establish Charles Xavier, the mutant team, and the legacy mutant continuity before the MCU directly engages alternate Marvel universes.";
    }
  }

  const releaseMoment = new Date(`${item.releaseDate}T00:00:00`).getTime();
  if (releaseMoment > Date.now()) {
    return `Scheduled transmission: releases ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(releaseMoment))}.`;
  }

  return null;
}

export function isUnlocked(item: ContentItem, watched: Set<string>) {
  return unlockReason(item, watched) === null;
}

export function formatRuntime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutesLeft = Math.floor((seconds % 3600) / 60);
  const secondsLeft = seconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutesLeft).padStart(2, "0")}m ${String(secondsLeft).padStart(2, "0")}s`;
}
