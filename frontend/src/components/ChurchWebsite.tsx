import { ChevronDown, Edit3, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  getAdminSiteContent,
  getSessionUser,
  getSiteContent,
  updateSiteContentBlock,
  type SessionUser,
  type SiteContentBlock,
} from "../api";

const wixMedia = "https://static.wixstatic.com/media";

const images = {
  logo: `${wixMedia}/4e2331_371ab01dfadd4d56ae8abfef198e0e82~mv2.png/v1/fill/w_196,h_72,al_c,q_90,enc_auto/listowelcf_logo_colour.png`,
  hero: `${wixMedia}/4e2331_1cdfc5c40d624ec1832773c562eb2f8c~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_88,enc_auto/4e2331_1cdfc5c40d624ec1832773c562eb2f8c~mv2.jpg`,
  praise: `${wixMedia}/4e2331_0a3b715f2be64f1390b98762888d8dce~mv2.png/v1/crop/x_0,y_0,w_505,h_600/fill/w_980,h_1165,al_l,q_88,enc_auto/home_priase_team2.png`,
  jpHome: `${wixMedia}/4e2331_5b584807159048c081b4786dfe85f9f7~mv2.jpg/v1/fill/w_760,h_1040,al_c,q_85,enc_auto/JP_home.jpg`,
  weekly: `${wixMedia}/4e2331_95d01d2f0bc546f38ed9aede99c7cbe1~mv2.jpg/v1/fill/w_720,h_720,al_c,q_85,enc_auto/weekly_prog2.jpg`,
  homePraise: `${wixMedia}/4e2331_3b604d68e68444f081b5a16db5ed0008~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/home_praise.jpg`,
  children: `${wixMedia}/4e2331_425d148b3d054c5c80ed9b6c8e9dfbfe~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/children.jpg`,
  prayerMeeting: `${wixMedia}/4e2331_3fa7f504aa4b4aca8976db514b04cd8a~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/4e2331_3fa7f504aa4b4aca8976db514b04cd8a~mv2.jpg`,
  programmeHero: `${wixMedia}/4e2331_be769f4cab714805b6bfebc002a3e532~mv2.jpg/v1/fill/w_1600,h_760,al_c,q_85,enc_auto/4e2331_be769f4cab714805b6bfebc002a3e532~mv2.jpg`,
  expectHero: `${wixMedia}/4e2331_b7c0f3ea58274ad1bdf3c05d802e5a5f~mv2.jpg/v1/fill/w_1600,h_760,al_c,q_85,enc_auto/4e2331_b7c0f3ea58274ad1bdf3c05d802e5a5f~mv2.jpg`,
  leadershipWide: `${wixMedia}/4e2331_f09e630e139a409e99080e9c87e5c7d7~mv2.jpg/v1/fill/w_1600,h_760,al_c,q_85,enc_auto/4e2331_f09e630e139a409e99080e9c87e5c7d7~mv2.jpg`,
  jpFidelma: `${wixMedia}/4e2331_84b1d79b12c4407a8b251061f99c32b0~mv2.jpg/v1/fill/w_520,h_520,al_c,q_85,enc_auto/JP_fidelma.jpg`,
  about1: `${wixMedia}/4e2331_d77935f615ca412a8483b50a9583cbe7~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/about1.jpg`,
  about2: `${wixMedia}/4e2331_e6c2b8a5598f465c889e3cd7e02430cb~mv2.jpg/v1/fill/w_900,h_760,al_c,q_85,enc_auto/about2.jpg`,
  about3: `${wixMedia}/4e2331_6565db907e924357aee17c21e5ae225d~mv2.jpg/v1/fill/w_1000,h_740,al_c,q_85,enc_auto/about3.jpg`,
  aboutStatement: `${wixMedia}/4e2331_ce1d4282fc0747d08ff3d13e12f67a8d~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/4e2331_ce1d4282fc0747d08ff3d13e12f67a8d~mv2.jpg`,
  storyIntro: `${wixMedia}/4e2331_1afb8600200e4680b546f49282cdfe15~mv2.jpg/v1/fill/w_1600,h_760,al_c,q_85,enc_auto/4e2331_1afb8600200e4680b546f49282cdfe15~mv2.jpg`,
  story: `${wixMedia}/4e2331_be17ad5d62e54d5fb9cd109203761f08~mv2.jpg/v1/fill/w_1200,h_670,al_c,q_85,enc_auto/4e2331_be17ad5d62e54d5fb9cd109203761f08~mv2.jpg`,
  plaque: `${wixMedia}/4e2331_c95c5602f69343ce868db8da139c0947~mv2.jpg/v1/fill/w_760,h_520,al_c,q_85,enc_auto/Plaque.jpg`,
  ribbon: `${wixMedia}/4e2331_ed0ad50c28bd485d974636882f915773~mv2.jpg/v1/fill/w_760,h_760,al_c,q_85,enc_auto/ribbon.jpg`,
  message: `${wixMedia}/4e2331_f514fe6b99204b428864c148f3c8d710~mv2.jpg/v1/fill/w_760,h_760,al_c,q_85,enc_auto/message.jpg`,
  follow: `${wixMedia}/4e2331_1c09e362d1c34a9d8ca33fec6dd2e918~mv2.png/v1/fill/w_180,h_144,al_c,q_90,enc_auto/follow.png`,
  joinIcon: `${wixMedia}/4e2331_8b4ebc807a9d44a697968be041344e36~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/joinus_5.png`,
  believeIcon: `${wixMedia}/4e2331_49bb0981e390464593a5eacb4c91fe48~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/believe.png`,
  leaderIcon: `${wixMedia}/4e2331_1de5a771c6974bc2890e8123df53f36b~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/leaership.png`,
  jesusHero: `${wixMedia}/4e2331_2db4c181bf2f4e3fb0614ac87499a9ef~mv2.jpg/v1/fill/w_1600,h_760,al_c,q_85,enc_auto/4e2331_2db4c181bf2f4e3fb0614ac87499a9ef~mv2.jpg`,
  gospel2: `${wixMedia}/4e2331_bea261caec9a43dc8cb0938522c0feb8~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/gospel_2.jpg`,
  gospel3: `${wixMedia}/4e2331_1dfd583e2d4c4bb980ef40d0108f5fc3~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/gospel_3.jpg`,
  gospel5: `${wixMedia}/4e2331_3aabf88c50454902b9cfc5c8386d86e3~mv2.jpg/v1/fill/w_900,h_900,al_c,q_85,enc_auto/gospel_5.jpg`,
  openBook: `${wixMedia}/4e2331_7c77d9ad74b34674b52a297db3536d74~mv2.png/v1/fill/w_220,h_160,al_c,q_90,enc_auto/open-book-side-view.png`,
  speaker: `${wixMedia}/4e2331_08f7107701564906a5083eea265dc332~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/speaker.png`,
  shrug: `${wixMedia}/4e2331_579973b167a34fdf8d4becd304f18ffb~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/shrug.png`,
  dove: `${wixMedia}/4e2331_ced2495804d34ac99ebde750f66f19d8~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/dove.png`,
  musicNote: `${wixMedia}/4e2331_63533bb1c6814cc9b753502806e497b2~mv2.png/v1/fill/w_120,h_120,al_c,q_90,enc_auto/music-note.png`,
  phoneIcon: `${wixMedia}/4e2331_653ae791baef45fa86e85de593b81407~mv2.png/v1/fill/w_70,h_70,al_c,q_90,enc_auto/smartphone.png`,
  emailIcon: `${wixMedia}/4e2331_f3721d6d8af947b6931c52c73f1f474c~mv2.png/v1/fill/w_70,h_70,al_c,q_90,enc_auto/email.png`,
  pinIcon: `${wixMedia}/4e2331_63f3a2362d8e48a49c85c769fb26965b~mv2.png/v1/fill/w_70,h_70,al_c,q_90,enc_auto/pin.png`,
  facebookIcon: `${wixMedia}/4e2331_626994c5f360451caac89f48f2735805~mv2.png/v1/fill/w_70,h_70,al_c,q_90,enc_auto/facebook.png`,
  prayerHero: `${wixMedia}/4e2331_454607b0eb0b406681412cfb4636ea35~mv2.jpg/v1/fill/w_1280,h_590,al_c,q_85,enc_auto/4e2331_454607b0eb0b406681412cfb4636ea35~mv2.jpg`,
  contactHero: `${wixMedia}/4e2331_9251f8ff490a4b89bb87c67d38ccbeed~mv2.jpg/v1/fill/w_1280,h_590,al_c,q_85,enc_auto/4e2331_9251f8ff490a4b89bb87c67d38ccbeed~mv2.jpg`,
  prayerBand: `${wixMedia}/4e2331_6a5e213031d14d24917da5d295f951e9~mv2.jpg/v1/fill/w_1600,h_580,al_c,q_85,enc_auto/prayer_background.jpg`,
  building: `${wixMedia}/4e2331_3184ae2041a94076b7a09018f027d1f0~mv2.jpg/v1/fill/w_1920,h_740,al_c,q_88,enc_auto/church_building.jpg`,
};

type PublicPage = "home" | "believe" | "story" | "leadership" | "jesus" | "programme" | "expect" | "prayer" | "contact";
type ContentLookup = (key: string, fallback: string) => string;

const editableSiteBlocks = [
  {
    key: "home.hero.title",
    label: "Homepage hero title",
    value: "Sharing Jesus. Loving one another.",
  },
  {
    key: "home.sunday.heading",
    label: "Homepage Sunday heading",
    value: "Join us this Sunday, 11am",
  },
  {
    key: "home.sunday.body",
    label: "Homepage Sunday body",
    value:
      "Sunday gatherings are a key moment in the life of our church — a time to come together in worship, grow through Scripture, pray for each other, and make room to listen to the Spirit. Everyone is welcome to join us.",
  },
  {
    key: "home.link.programme",
    label: "Homepage card: Weekly programme",
    value: "Weekly programme",
  },
  {
    key: "home.link.believe",
    label: "Homepage card: What we believe",
    value: "What we believe",
  },
  {
    key: "home.link.leadership",
    label: "Homepage card: Leadership team",
    value: "Leadership team",
  },
  {
    key: "shared.follow.heading",
    label: "Follow Jesus strip heading",
    value: "Follow Jesus",
  },
  {
    key: "shared.follow.body",
    label: "Follow Jesus strip body",
    value: "How we got here and how God wants us to respond.",
  },
  {
    key: "shared.follow.button",
    label: "Follow Jesus strip button",
    value: "Tell me more",
  },
  {
    key: "story.opening",
    label: "Our Story opening",
    value:
      "In 2002 we purchased a site on the Ballybunion road with a view to developing a purpose built center for all of our activities, including meetings and children’s work.\n\nFinally after 4 years’ hard work we achieved our goal which was achieved almost entirely by voluntary giving of time and resources from Christians locally and from around the world.\n\nThe building, named An Teach Solais, was opened and dedicated in a ceremony officiated by the Mayor of Listowel, Councillor Pat Loughnane, on April 19th, 2008.",
  },
  {
    key: "story.dedication",
    label: "Our Story dedication text",
    value:
      "The Mayor gave an official welcome to the community of Listowel Christian Fellowship and requested that the first prayer be for the creation of new jobs for the people of Listowel. The MC for the day Mr Stephen Cardy, a member of the Leadership Team of An Teach Solais, took the opportunity to do that and prayed for the prosperity of Listowel and its surrounding areas both spiritually and physically.",
  },
  {
    key: "story.memory.extra",
    label: "Our Story memory text",
    value:
      "There was also an address by much loved and respected local businessman, Mr Danny Hannon, who moved his audience to laughter and tears in his enjoyable oration. He gave a warm blessing to the new place of prayer and worship.\n\nNí Neart go cur le cheile\nThere is no strength without unity\n\nApproximately 300 people attended the event, which climaxed with refreshments and a concert by the Fellowship Music Group.",
  },
  {
    key: "shared.prayer.heading",
    label: "Prayer banner heading",
    value: "Need Prayer?",
  },
  {
    key: "shared.prayer.body",
    label: "Prayer banner body",
    value:
      "Life isn't always simple. Thankfully, prayer is. The Lord delights when we seek His face for comfort, reassurance and healing. We are here to stand with you in prayer.",
  },
  {
    key: "prayer.page.opening",
    label: "Prayer page opening line",
    value: "We know that every prayer is heard by God, and that He responds in His perfect way.",
  },
  {
    key: "prayer.page.body",
    label: "Prayer page body",
    value:
      "No matter what you’re facing, you are deeply loved and seen by Him. Sometimes we need others to pray on our behalf — whether we feel overwhelmed, can’t find the right words, or simply long to know we’re not alone in our struggles.\n\nIf you’d like someone to pray for you, please complete the form below. If you’d like us to follow up with you personally, feel free to include your phone number or email in your message.",
  },
  {
    key: "believe.intro",
    label: "What we believe intro",
    value:
      "Listowel Christian Fellowship is a bible based community seeking to communicate the good news of Jesus Christ in a culturally sensitive way while nurturing body, soul and spirit.",
  },
  {
    key: "believe.relationship",
    label: "What we believe relationship text",
    value:
      "A living relationship with Jesus is what we hold most dear and encourage at LCF. Because of what Christ did on the cross, a way has opened up for each one of us to come to God the Father and have a personal relationship with Him.\n\nWe believe one is not born a Christian, but at some stage in life has to come to a personal saving faith in Christ.",
  },
  {
    key: "believe.statement.intro",
    label: "Statement of Faith intro",
    value:
      "At Listowel Christian Fellowship, we are all about Jesus. Our faith is rooted in the truth of Scripture, and we seek to live out that faith with love, grace, and the power of the Holy Spirit.\n\nHere’s what we believe:",
  },
  {
    key: "believe.statement.god",
    label: "Statement of Faith: God",
    value: "We believe in one God—Father, Son, and Holy Spirit—who is loving, holy, and completely in control. He created everything, sustains everything, and is working out His plan of redemption in the world.",
  },
  {
    key: "believe.statement.jesus",
    label: "Statement of Faith: Jesus Christ",
    value: "Jesus is the Son of God, fully God and fully man. He lived a perfect life, died on the cross for our sins, and rose again, conquering death. He is the only way to salvation, and one day, He will return to make all things new.",
  },
  {
    key: "believe.statement.bible",
    label: "Statement of Faith: The Bible",
    value: "The Bible is God’s inspired Word, completely true and our ultimate authority in life and faith. Through it, God reveals who He is and how we should live.",
  },
  {
    key: "believe.statement.salvation",
    label: "Statement of Faith: Salvation",
    value: "We are saved by grace through faith in Jesus. It’s not about what we do but what He has done for us. When we trust in Him, we are forgiven, made new, and brought into God’s family forever.",
  },
  {
    key: "believe.statement.spirit",
    label: "Statement of Faith: The Holy Spirit",
    value: "God’s Spirit lives in every believer, guiding, empowering, and transforming us to become more like Jesus. We believe the gifts of the Spirit are active today and that God still speaks, heals, and moves in miraculous ways.",
  },
  {
    key: "believe.statement.church",
    label: "Statement of Faith: The Church",
    value: "We are the body of Christ, called to love God, love people, and make disciples. Church is more than a building—it’s a family, a mission, and a place where God’s presence is real.",
  },
  {
    key: "believe.statement.mission",
    label: "Statement of Faith: Our Mission",
    value: "We exist to share the hope of Jesus with the world, living out our faith in everyday life and inviting others into God’s incredible story of redemption.",
  },
  {
    key: "leadership.team.body",
    label: "Leadership team body",
    value:
      "Listowel Christian Fellowship began in the home of JP and Fidelma in the 1990s, as a small gathering of believers studying the scriptures and seeking to follow Jesus in a simple and authentic way. Over time, the church grew and in 2004 moved into their present purpose-built centre on the Ballybunion road.",
  },
  {
    key: "leadership.team.extra",
    label: "Leadership team second paragraph",
    value:
      "Our leadership is committed to serving with humility, love, and a deep dependence on the Holy Spirit. We welcome all who desire to grow in faith and walk together in this journey of following Jesus.",
  },
  {
    key: "jesus.opening",
    label: "Follow Jesus opening",
    value:
      "To make sense of why the world is so broken today, we have to go right back to the beginning. Back when God spoke all creation into being and gave life to every living creature, including that of Adam. A truth which of course the evolutionist seeks to deny in his attempt to run from God.",
  },
  {
    key: "jesus.opening.extra",
    label: "Follow Jesus hero second paragraph",
    value:
      "But we know from scripture that God placed Adam and Eve in the Garden for a purpose — to glorify God and enjoy him forever. Satan twisted what God had said and Adam and Eve gave it all up because of the pride in their hearts.",
  },
  {
    key: "jesus.separated",
    label: "Follow Jesus: separated from God",
    value:
      "From this point on, the heart of every man and women would be infected with sin. Whilst God has never stopping loving His creation, because of Adams disobedience all of us are born in sin and separated from a Holy God.",
  },
  {
    key: "jesus.madeWay",
    label: "Follow Jesus: Jesus made a way",
    value:
      "God so loved you, He sent His only begotten son to this earth over 2000 years ago, He was born of a virgin called Mary as our only way of Salvation. He lived a sinless life, healed the sick, opened blinded eyes, and died on the cross for you.",
  },
  {
    key: "jesus.joy",
    label: "Follow Jesus: joy section",
    value:
      "This is only the beginning of what God has in store for you. Not only is it God's will that none should perish, He also wants to give us life and life more abundant. Joy, peace and power to live life just as God had originally planned.",
  },
  {
    key: "jesus.verse",
    label: "Follow Jesus verse strip",
    value: "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new.",
  },
  {
    key: "programme.sunday.body",
    label: "Weekly Programme Sunday Worship",
    value:
      "The Sunday meeting is the focal point of our weekly activities. We gather from 11 to 1 for teaching and worship with music joyfully led by Audrey, Chris and the team. After the meeting, we usually share lunch together.",
  },
  {
    key: "programme.sunday.title",
    label: "Weekly Programme Sunday title",
    value: "Sunday Worship",
  },
  {
    key: "programme.children.body",
    label: "Weekly Programme Children",
    value:
      "We take special care to make our gatherings welcoming and meaningful for children, with age-appropriate groups, workbooks, crafts, interactive activities, and plenty of fun.",
  },
  {
    key: "programme.children.title",
    label: "Weekly Programme Children title",
    value: "Children",
  },
  {
    key: "programme.prayer.body",
    label: "Weekly Programme Prayer Meeting",
    value:
      "Every Thursday at 8, we come together to seek God in prayer. We lift up specific needs and count it a privilege to intercede for friends, family, and others beyond our fellowship.",
  },
  {
    key: "programme.prayer.title",
    label: "Weekly Programme Prayer title",
    value: "Prayer Meeting",
  },
  {
    key: "expect.service.body",
    label: "What to Expect service body",
    value:
      "The service will start at 11am with a time of praise and worship. Don’t worry if you don’t know all the songs. The words will be on the screen to help you follow along. In addition to the formal teaching from the scriptures, all who attend are encouraged to participate by reading a scripture, sharing a word of encouragement or suggesting a song.",
  },
  {
    key: "expect.question.one",
    label: "What to Expect question 1",
    value: "Can I come if I am not a Christian or have a different faith?",
  },
  {
    key: "expect.answer.one",
    label: "What to Expect answer 1",
    value: "Yes. Everyone is free to attend our services. We believe Christ offers life and salvation to all who seek Him.",
  },
  {
    key: "expect.question.two",
    label: "What to Expect question 2",
    value: "Do you believe in the works of the Holy Spirit?",
  },
  {
    key: "expect.answer.two",
    label: "What to Expect answer 2",
    value: "We do. We believe God speaks today through the Bible and by His Spirit through His people, using gifts He gives them.",
  },
  {
    key: "expect.question.three",
    label: "What to Expect question 3",
    value: "Will I have to sing or take part?",
  },
  {
    key: "expect.answer.three",
    label: "What to Expect answer 3",
    value: "You don't have to do anything you don’t want to. We invite you to enjoy the service and be open to what is shared.",
  },
  {
    key: "contact.intro",
    label: "Contact page intro",
    value:
      "Have questions about something you’ve read, or just curious to find out more about us? We’d love to hear from you! Feel free to reach out using the details below. We’re always happy to chat and help in any way we can.",
  },
  ...Object.entries(images).map(([key, value]) => ({
    key: `image.${key}`,
    label: `Image: ${key}`,
    value,
  })),
  {
    key: "footer.address",
    label: "Footer address",
    value: "Shrone West, Listowel, Co. Kerry, Ireland",
  },
  {
    key: "footer.email",
    label: "Footer email",
    value: "lcfkerry@gmail.com",
  },
  {
    key: "footer.phone",
    label: "Footer phone",
    value: "+353 87 952 9907",
  },
] satisfies Array<{ key: string; label: string; value: string }>;

const pagePaths: Record<PublicPage, string> = {
  home: "/",
  believe: "/believe",
  story: "/story",
  leadership: "/leadership",
  jesus: "/jesus",
  programme: "/programme",
  expect: "/programme-1",
  prayer: "/prayer",
  contact: "/contact",
};

const pathPages = Object.fromEntries(Object.entries(pagePaths).map(([page, path]) => [path, page])) as Record<string, PublicPage>;

const pageContentPrefixes: Record<PublicPage, string[]> = {
  home: ["home.", "shared.", "image.", "footer."],
  believe: ["believe.", "shared.", "image.", "footer."],
  story: ["story.", "shared.", "image.", "footer."],
  leadership: ["leadership.", "shared.", "image.", "footer."],
  jesus: ["jesus.", "shared.", "image.", "footer."],
  programme: ["programme.", "shared.", "image.", "footer."],
  expect: ["expect.", "shared.", "image.", "footer."],
  prayer: ["prayer.", "shared.", "image.", "footer."],
  contact: ["contact.", "shared.", "image.", "footer."],
};

function currentPageFromPath(): PublicPage {
  return pathPages[window.location.pathname] ?? "home";
}

function ScrollReveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wix-reveal ${className}`}>{children}</div>;
}

function textBlock(key: string) {
  return editableSiteBlocks.find((block) => block.key === key)?.value ?? "";
}

function imageBlock(content: ContentLookup, key: keyof typeof images) {
  return content(`image.${key}`, images[key]);
}

export function ChurchWebsite() {
  const [page, setPage] = useState<PublicPage>(() => currentPageFromPath());
  const [openMenu, setOpenMenu] = useState<"about" | "life" | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [siteBlocks, setSiteBlocks] = useState<SiteContentBlock[]>([]);
  const [adminBlocks, setAdminBlocks] = useState<SiteContentBlock[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);

  const contentMap = useMemo(() => {
    const map = new Map(editableSiteBlocks.map((block) => [block.key, block.value]));
    for (const block of siteBlocks) {
      map.set(block.key, block.value);
    }
    return map;
  }, [siteBlocks]);

  const content: ContentLookup = (key, fallback) => contentMap.get(key) ?? fallback;
  const isSiteAdmin = Boolean(sessionUser?.permissions.includes("site:edit") || sessionUser?.permissions.includes("users:manage"));

  const editableBlocks = useMemo(() => {
    const adminMap = new Map(adminBlocks.map((block) => [block.key, block]));
    return editableSiteBlocks.map((definition) => adminMap.get(definition.key) ?? {
      id: definition.key,
      key: definition.key,
      label: definition.label,
      block_type: "text",
      value: definition.value,
      draft_value: null,
      published: true,
      updated_at: "",
    });
  }, [adminBlocks]);

  const pageEditableBlocks = useMemo(() => {
    const prefixes = pageContentPrefixes[page];
    return editableBlocks.filter((block) => prefixes.some((prefix) => block.key.startsWith(prefix)));
  }, [editableBlocks, page]);

  useEffect(() => {
    function handlePopState() {
      setPage(currentPageFromPath());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);

  useEffect(() => {
    void getSiteContent()
      .then(setSiteBlocks)
      .catch(() => setSiteBlocks([]));
    void getSessionUser()
      .then(setSessionUser)
      .catch(() => setSessionUser(null));
  }, []);

  useEffect(() => {
    if (!isSiteAdmin) {
      setAdminBlocks([]);
      return;
    }

    void getAdminSiteContent()
      .then(setAdminBlocks)
      .catch(() => setAdminBlocks([]));
  }, [isSiteAdmin]);

  const pageTitle = useMemo(() => {
    if (page === "home") return "Home";
    if (page === "expect") return "What to Expect";
    return {
      believe: "What we Believe",
      story: "Our Story",
      leadership: "Leadership",
      jesus: "Follow Jesus",
      programme: "Weekly Programme",
      prayer: "Request Prayer",
      contact: "Contact Us",
    }[page];
  }, [page]);

  function navigate(nextPage: PublicPage) {
    setOpenMenu(null);
    const nextPath = pagePaths[nextPage];
    if (nextPath !== window.location.pathname) {
      window.history.pushState({}, "", nextPath);
    }
    setPage(nextPage);
  }

  async function saveBlock(block: SiteContentBlock, value: string) {
    setSavingKey(block.key);
    setEditorMessage(null);
    try {
      const saved = await updateSiteContentBlock(block.key, {
        label: block.label,
        block_type: block.block_type,
        value,
        published: block.published,
      });
      setAdminBlocks((current) => {
        const others = current.filter((candidate) => candidate.key !== saved.key);
        return [...others, saved].sort((a, b) => a.key.localeCompare(b.key));
      });
      setSiteBlocks((current) => {
        const others = current.filter((candidate) => candidate.key !== saved.key);
        return saved.published ? [...others, saved] : others;
      });
      setEditorMessage("Saved.");
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "Could not save that content block.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <main className="church-site wix-clone wix-exact">
      <div className="wix-studio-bar">Built on WIX STUDIO</div>
      <header className="church-nav wix-nav">
        <button className="church-nav-brand wix-brand" type="button" onClick={() => navigate("home")}>
          <img alt="Listowel Christian Fellowship" src={imageBlock(content, "logo")} />
        </button>
        <nav aria-label="Website">
          <button type="button" onClick={() => navigate("home")}>
            Home
          </button>
          <div className="wix-menu-group" onMouseEnter={() => setOpenMenu("about")} onMouseLeave={() => setOpenMenu(null)}>
            <button aria-expanded={openMenu === "about"} type="button" onClick={() => setOpenMenu((current) => current === "about" ? null : "about")}>
              About Us <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className={`wix-dropdown ${openMenu === "about" ? "is-open" : ""}`}>
              <button type="button" onClick={() => navigate("believe")}>What we Believe</button>
              <button type="button" onClick={() => navigate("story")}>Our Story</button>
              <button type="button" onClick={() => navigate("leadership")}>Leadership Team</button>
              <button type="button" onClick={() => navigate("jesus")}>Follow Jesus</button>
            </div>
          </div>
          <div className="wix-menu-group" onMouseEnter={() => setOpenMenu("life")} onMouseLeave={() => setOpenMenu(null)}>
            <button aria-expanded={openMenu === "life"} type="button" onClick={() => setOpenMenu((current) => current === "life" ? null : "life")}>
              Church Life <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className={`wix-dropdown ${openMenu === "life" ? "is-open" : ""}`}>
              <button type="button" onClick={() => navigate("programme")}>Weekly Programme</button>
              <button type="button" onClick={() => navigate("expect")}>What to Expect</button>
              <button type="button" onClick={() => navigate("prayer")}>Request Prayer</button>
            </div>
          </div>
          <button type="button" onClick={() => navigate("contact")}>
            Contact Us
          </button>
        </nav>
        <a className="church-member-link wix-member-link" href="/app">
          Members Login
        </a>
      </header>

      {isSiteAdmin ? (
        <button className="site-edit-toggle" type="button" onClick={() => setEditorOpen(true)}>
          <Edit3 size={16} aria-hidden="true" />
          Edit Site
        </button>
      ) : null}

      {editorOpen ? (
        <SiteEditorDialog
          blocks={pageEditableBlocks}
          message={editorMessage}
          onClose={() => setEditorOpen(false)}
          pageTitle={pageTitle}
          onSave={saveBlock}
          savingKey={savingKey}
        />
      ) : null}

      {page === "home" ? (
        <HomePage content={content} navigate={navigate} />
      ) : (
        <InteriorPage content={content} page={page} pageTitle={pageTitle} navigate={navigate} />
      )}
    </main>
  );
}

function HomePage({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  return (
    <>
      <section className="wix-hero" id="home">
        <img alt="" src={imageBlock(content, "hero")} />
        <div className="wix-hero-overlay" />
        <div className="wix-hero-copy">
          <h1>{content("home.hero.title", "Sharing Jesus. Loving one another.")}</h1>
        </div>
      </section>

      <section className="wix-sunday-section">
        <ScrollReveal className="wix-sunday-copy">
          <h2>{content("home.sunday.heading", "Join us this Sunday, 11am")}</h2>
          <p>{content("home.sunday.body", textBlock("home.sunday.body"))}</p>
          <button type="button" onClick={() => navigate("expect")}>What to expect</button>
        </ScrollReveal>
        <div className="wix-sunday-image wix-sunday-collage">
          <div className="wix-sunday-musicians crop-worship-right">
            <img alt="" src={imageBlock(content, "praise")} />
          </div>
          <img className="wix-home-portrait" alt="" src={imageBlock(content, "jpHome")} />
          <img className="wix-congregation-tile" alt="" src={imageBlock(content, "about2")} />
        </div>
      </section>

      <PrayerBand content={content} onPrayer={() => navigate("prayer")} />

      <section className="wix-link-grid">
        <button className="wix-link-card" type="button" onClick={() => navigate("programme")}>
          <img alt="" src={imageBlock(content, "weekly")} />
          <span>{content("home.link.programme", "Weekly programme")}</span>
        </button>
        <button className="wix-link-card" type="button" onClick={() => navigate("believe")}>
          <img alt="" src={imageBlock(content, "about1")} />
          <span>{content("home.link.believe", "What we believe")}</span>
        </button>
        <button className="wix-link-card" type="button" onClick={() => navigate("leadership")}>
          <img alt="" src={imageBlock(content, "leadershipWide")} />
          <span>{content("home.link.leadership", "Leadership team")}</span>
        </button>
      </section>

      <section className="wix-story-strip">
        <img alt="" src={imageBlock(content, "follow")} />
        <div>
          <h2>{content("shared.follow.heading", "Follow Jesus")}</h2>
          <p>{content("shared.follow.body", "How we got here and how God wants us to respond.")}</p>
          <button type="button" onClick={() => navigate("jesus")}>{content("shared.follow.button", "Tell me more")}</button>
        </div>
      </section>

      <section
        className="wix-building-parallax"
        aria-label="Listowel Christian Fellowship building"
        style={{ backgroundImage: `url(${imageBlock(content, "building")})` }}
      />

      <SiteFooter content={content} navigate={navigate} />
    </>
  );
}

function InteriorPage({
  page,
  pageTitle,
  navigate,
  content,
}: {
  page: PublicPage;
  pageTitle: string;
  navigate: (page: PublicPage) => void;
  content: ContentLookup;
}) {
  return (
    <>
      <section className={`wix-page-hero wix-page-${page}`}>
        <div>
          <p>{pageTitle}</p>
          <h1>{pageTitle}</h1>
        </div>
      </section>

      {page === "believe" && <BelievePage content={content} />}
      {page === "story" && <StoryPage content={content} />}
      {page === "leadership" && <LeadershipPage content={content} />}
      {page === "jesus" && <JesusPage content={content} />}
      {page === "programme" && <ProgrammePage content={content} navigate={navigate} />}
      {page === "expect" && <ExpectPage content={content} navigate={navigate} />}
      {page === "prayer" && <PrayerPage content={content} navigate={navigate} />}
      {page === "contact" && <ContactPage content={content} navigate={navigate} />}

      {page === "programme" && (
        <section className="wix-story-strip">
          <img alt="" src={imageBlock(content, "follow")} />
          <div>
            <h2>{content("shared.follow.heading", "Follow Jesus")}</h2>
            <p>{content("shared.follow.body", "How we got here and how God wants us to respond.")}</p>
            <button type="button" onClick={() => navigate("jesus")}>{content("shared.follow.button", "Tell me more")}</button>
          </div>
        </section>
      )}

      <SiteFooter content={content} navigate={navigate} />
    </>
  );
}

function BelievePage({ content }: { content: ContentLookup }) {
  const sections = [
    ["God", content("believe.statement.god", textBlock("believe.statement.god"))],
    ["Jesus Christ", content("believe.statement.jesus", textBlock("believe.statement.jesus"))],
    ["The Bible", content("believe.statement.bible", textBlock("believe.statement.bible"))],
    ["Salvation", content("believe.statement.salvation", textBlock("believe.statement.salvation"))],
    ["The Holy Spirit", content("believe.statement.spirit", textBlock("believe.statement.spirit"))],
    ["The Church", content("believe.statement.church", textBlock("believe.statement.church"))],
    ["Our Mission", content("believe.statement.mission", textBlock("believe.statement.mission"))],
  ];
  const introParagraphs = content("believe.statement.intro", textBlock("believe.statement.intro")).split(/\n\n+/);

  return (
    <section className="wix-believe-page">
      <section className="wix-believe-grid">
        <div className="wix-believe-panel large">
          <h2>What we believe</h2>
          <p>{content("believe.intro", textBlock("believe.intro"))}</p>
        </div>
        <img alt="" src={imageBlock(content, "about1")} />
        <img alt="" src={imageBlock(content, "about2")} />
        <div className="wix-believe-panel text">
          {content("believe.relationship", textBlock("believe.relationship"))
            .split(/\n\n+/)
            .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </section>
      <section className="wix-statement-section" style={{ backgroundImage: `url(${imageBlock(content, "about3")})` }}>
        <div className="wix-statement-inner">
          <h2>Statement of Faith</h2>
          {introParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {sections.map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function StoryPage({ content }: { content: ContentLookup }) {
  return (
    <section className="wix-story-page">
      <ImageBanner image={imageBlock(content, "storyIntro")} fixed />
      <section className="wix-story-origin">
        <div>
          {content("story.opening", textBlock("story.opening"))
            .split(/\n\n+/)
            .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <img alt="" src={imageBlock(content, "plaque")} />
      </section>
      <section className="wix-story-memory">
        <div className="wix-story-memory-images">
          <img alt="" src={imageBlock(content, "ribbon")} />
          <img alt="" src={imageBlock(content, "message")} />
        </div>
        <p>{content("story.dedication", textBlock("story.dedication"))}</p>
        {content("story.memory.extra", textBlock("story.memory.extra"))
          .split(/\n\n+/)
          .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </section>
      <section className="wix-wide-photo fixed" style={{ backgroundImage: `url(${imageBlock(content, "story")})` }} />
    </section>
  );
}

function LeadershipPage({ content }: { content: ContentLookup }) {
  return (
    <section className="wix-leadership-page">
      <ImageBanner image={imageBlock(content, "leadershipWide")} />
      <ScrollReveal className="wix-page-copy center">
        <h2>The Team</h2>
        <p>{content("leadership.team.body", textBlock("leadership.team.body"))}</p>
        <p>{content("leadership.team.extra", textBlock("leadership.team.extra"))}</p>
      </ScrollReveal>
      <div className="wix-leader-grid single">
        <ScrollReveal className="wix-leader-card">
          <img alt="" src={imageBlock(content, "jpFidelma")} />
          <h3>JP and Fidelma</h3>
        </ScrollReveal>
      </div>
    </section>
  );
}

function JesusPage({ content }: { content: ContentLookup }) {
  return (
    <section className="wix-jesus-page">
      <section className="wix-jesus-hero" style={{ backgroundImage: `url(${imageBlock(content, "jesusHero")})` }}>
        <p>{content("jesus.opening", textBlock("jesus.opening"))}</p>
        <p>{content("jesus.opening.extra", textBlock("jesus.opening.extra"))}</p>
      </section>
      <section className="wix-gospel-pair">
        <article>
          <figure>
            <img alt="" src={imageBlock(content, "gospel2")} />
            <figcaption>Separated from God</figcaption>
          </figure>
          <p>{content("jesus.separated", textBlock("jesus.separated"))}</p>
        </article>
        <article>
          <figure>
            <img alt="" src={imageBlock(content, "gospel3")} />
            <figcaption>Jesus made a way</figcaption>
          </figure>
          <p>{content("jesus.madeWay", textBlock("jesus.madeWay"))}</p>
        </article>
      </section>
      <section className="wix-joy-section">
        <p>{content("jesus.joy", textBlock("jesus.joy"))}</p>
        <img alt="" src={imageBlock(content, "gospel5")} />
      </section>
      <section className="wix-verse-strip">
        <img alt="" src={imageBlock(content, "openBook")} />
        <h2>{content("jesus.verse", textBlock("jesus.verse"))}</h2>
        <strong>2 Cor 5:17</strong>
      </section>
    </section>
  );
}

function ProgrammePage({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  const programme = [
    {
      title: content("programme.sunday.title", "Sunday Worship"),
      image: imageBlock(content, "homePraise"),
      className: "crop-worship-right",
      text: content("programme.sunday.body", textBlock("programme.sunday.body")),
    },
    {
      title: content("programme.children.title", "Children"),
      image: imageBlock(content, "children"),
      text: content("programme.children.body", textBlock("programme.children.body")),
    },
    {
      title: content("programme.prayer.title", "Prayer Meeting"),
      image: imageBlock(content, "prayerMeeting"),
      text: content("programme.prayer.body", textBlock("programme.prayer.body")),
    },
  ];

  return (
    <section className="wix-programme-page">
      <ImageBanner image={imageBlock(content, "programmeHero")} fixed />
      {programme.map((item, index) => (
        <article className={`wix-programme-row ${index % 2 ? "reverse" : ""}`} key={item.title}>
          <div className={`wix-programme-photo ${item.className ?? ""}`}>
            <img alt="" src={item.image} />
          </div>
          <ScrollReveal className="wix-programme-copy">
            <h2>{item.title}</h2>
            <p>{item.text}</p>
            {index === 0 && <button type="button" onClick={() => navigate("expect")}>What to expect</button>}
            {index === 2 && <button type="button" onClick={() => navigate("prayer")}>Request prayer</button>}
          </ScrollReveal>
        </article>
      ))}
    </section>
  );
}

function ExpectPage({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  const questions = [
    [imageBlock(content, "shrug"), content("expect.question.one", "Can I come if I am not a Christian or have a different faith?"), content("expect.answer.one", "Yes. Everyone is free to attend our services. We believe Christ offers life and salvation to all who seek Him.")],
    [imageBlock(content, "dove"), content("expect.question.two", "Do you believe in the works of the Holy Spirit?"), content("expect.answer.two", "We do. We believe God speaks today through the Bible and by His Spirit through His people, using gifts He gives them.")],
    [imageBlock(content, "musicNote"), content("expect.question.three", "Will I have to sing or take part?"), content("expect.answer.three", "You don't have to do anything you don’t want to. We invite you to enjoy the service and be open to what is shared.")],
  ];

  return (
    <section className="wix-expect-page">
      <ImageBanner image={imageBlock(content, "expectHero")} fixed />
      <section className="wix-service-explain">
        <img alt="" src={imageBlock(content, "speaker")} />
        <h2>What happens during the service?</h2>
        <p>{content("expect.service.body", textBlock("expect.service.body"))}</p>
      </section>
      <div className="wix-faq-grid">
        {questions.map(([icon, question, answer], index) => (
          <ScrollReveal className={`wix-faq-card tone-${index + 1}`} key={question}>
            <img alt="" src={icon} />
            <h3>{question}</h3>
            <p>{answer}</p>
          </ScrollReveal>
        ))}
      </div>
      <PrayerBand content={content} onPrayer={() => navigate("prayer")} />
    </section>
  );
}

function PrayerPage({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  return (
    <section className="wix-prayer-page">
      <div className="wix-wide-photo fixed crop-prayer-left" style={{ backgroundImage: `url(${imageBlock(content, "prayerHero")})` }} />
      <section className="wix-prayer-copy-band">
        <p>{content("prayer.page.opening", "We know that every prayer is heard by God, and that He responds in His perfect way.")}</p>
        {content("prayer.page.body", textBlock("prayer.page.body"))
          .split(/\n\n+/)
          .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </section>
      <div className="wix-prayer-form-wrap">
        <ContactForm buttonText="Submit" simple />
      </div>
      <section className="wix-story-strip">
        <img alt="" src={imageBlock(content, "follow")} />
        <div>
          <h2>{content("shared.follow.heading", "Follow Jesus")}</h2>
          <p>{content("shared.follow.body", "How we got here and how God wants us to respond.")}</p>
          <button type="button" onClick={() => navigate("jesus")}>{content("shared.follow.button", "Tell me more")}</button>
        </div>
      </section>
    </section>
  );
}

function ContactPage({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  return (
    <section className="wix-contact-page">
      <section className="wix-contact-hero" style={{ backgroundImage: `url(${imageBlock(content, "contactHero")})` }}>
        <p>{content("contact.intro", textBlock("contact.intro"))}</p>
      </section>
      <div className="wix-contact-layout">
        <ContactForm buttonText="Submit" />
        <section className="wix-contact-icon-row">
          <ContactIcon icon={imageBlock(content, "phoneIcon")} label={content("footer.phone", "+353 87 952 9907")} />
          <ContactIcon icon={imageBlock(content, "emailIcon")} label={content("footer.email", "lcfkerry@gmail.com")} />
          <ContactIcon icon={imageBlock(content, "pinIcon")} label={content("footer.address", "Shrone West, Listowel, Co. Kerry V31P635")} />
          <ContactIcon icon={imageBlock(content, "facebookIcon")} label="/listowelcfellowship" />
        </section>
      </div>
      <GoogleMap />
      <PrayerBand content={content} onPrayer={() => navigate("prayer")} />
    </section>
  );
}

function ImageBanner({ image, fixed = false }: { image: string; fixed?: boolean }) {
  return <section className={`wix-wide-photo ${fixed ? "fixed" : ""}`} style={{ backgroundImage: `url(${image})` }} />;
}

function ContactIcon({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="wix-contact-icon-card">
      <img alt="" src={icon} />
      <span>{label}</span>
    </div>
  );
}

function PrayerBand({ content, onPrayer }: { content: ContentLookup; onPrayer: () => void }) {
  return (
    <section className="wix-prayer-section" style={{ backgroundImage: `url(${imageBlock(content, "prayerBand")})` }}>
      <div>
        <p className="wix-small-heading">{content("shared.prayer.heading", "Need Prayer?")}</p>
        <p>{content("shared.prayer.body", textBlock("shared.prayer.body"))}</p>
      </div>
      <button type="button" onClick={onPrayer}>Request prayer today</button>
    </section>
  );
}

function ContactForm({ buttonText, simple = false }: { buttonText: string; simple?: boolean }) {
  return (
    <form className="wix-contact-form">
      <label>
        Name
        <input type="text" placeholder="Name" />
      </label>
      {!simple && (
        <label>
          Email
          <input type="email" placeholder="Email address" />
        </label>
      )}
      <label>
        Message
        <textarea rows={5} placeholder="Message" />
      </label>
      <button type="button">{buttonText}</button>
    </form>
  );
}

function GoogleMap() {
  return (
    <section className="wix-map">
      <iframe
        title="Listowel Christian Fellowship map"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src="https://www.google.com/maps?q=Shrone%20West%2C%20Listowel%2C%20Co.%20Kerry%20V31P635&output=embed"
      />
    </section>
  );
}

function SiteFooter({ content, navigate }: { content: ContentLookup; navigate: (page: PublicPage) => void }) {
  return (
    <footer className="wix-footer">
      <img alt="Listowel Christian Fellowship" src={imageBlock(content, "logo")} />
      <div>
        <p>{content("footer.address", "Shrone West, Listowel, Co. Kerry, Ireland")}</p>
        <p>{content("footer.email", "lcfkerry@gmail.com")}</p>
        <p>{content("footer.phone", "+353 87 952 9907")}</p>
      </div>
      <div className="wix-footer-links">
        <button type="button" onClick={() => navigate("believe")}>About Us</button>
        <button type="button" onClick={() => navigate("programme")}>Church Life</button>
        <a href="/app">Members Login</a>
      </div>
      <span>All rights reserved · Registered Charity CHY:14431</span>
    </footer>
  );
}

function SiteEditorDialog({
  blocks,
  message,
  onClose,
  pageTitle,
  onSave,
  savingKey,
}: {
  blocks: SiteContentBlock[];
  message: string | null;
  onClose: () => void;
  pageTitle: string;
  onSave: (block: SiteContentBlock, value: string) => Promise<void>;
  savingKey: string | null;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(blocks.map((block) => [block.key, block.value])));

  useEffect(() => {
    setValues(Object.fromEntries(blocks.map((block) => [block.key, block.value])));
  }, [blocks]);

  return (
    <div className="app-dialog-backdrop site-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Edit website content"
        aria-modal="true"
        className="app-dialog site-editor-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="site-editor-header">
          <div>
            <p className="eyebrow">Website</p>
            <h2>Edit {pageTitle}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close editor">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {message ? <p className="site-editor-message">{message}</p> : null}

        <div className="site-editor-list">
          {!blocks.length ? <p className="site-editor-message">No editable blocks are configured for this page yet.</p> : null}
          {blocks.map((block) => (
            <article className="site-editor-block" key={block.key}>
              <label>
                <span>{block.label}</span>
                <textarea
                  rows={block.key.startsWith("image.") ? 2 : block.value.length > 140 ? 5 : 3}
                  value={values[block.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [block.key]: event.target.value }))}
                />
              </label>
              <button
                className="text-button"
                type="button"
                disabled={savingKey === block.key}
                onClick={() => void onSave(block, values[block.key] ?? "")}
              >
                {savingKey === block.key ? "Saving..." : "Save"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
