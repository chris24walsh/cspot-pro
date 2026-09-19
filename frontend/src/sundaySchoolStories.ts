import type { SchoolSoundCue } from "./sundaySchoolSound";

export interface StoryLayer {
  id: string;
  asset: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  motion?: "bounce" | "shake";
  rotation?: number;
}

type StoryAction =
  | { op: "show" | "hide" | "bounce" | "shake"; target: string }
  | { op: "move"; target: string; x: number; y: number; rotation?: number }
  | { op: "playAudio"; sound: SchoolSoundCue };

interface StoryCue { label: string; teacherText?: string; actions: StoryAction[] }
interface StoryScene {
  title: string;
  background: "land" | "harbour" | "sea" | "storm";
  teacherText: string;
  audio?: SchoolSoundCue;
  layers: StoryLayer[];
  cues: StoryCue[];
}
export interface SchoolStory { id: string; title: string; reference: string; scenes: StoryScene[] }

const person = (x: number, y: number, visible = true): StoryLayer => ({ id: "jonah", asset: "person", label: "Jonah", x, y, width: 10, height: 30, visible });
const boat = (x: number, y: number, visible = true): StoryLayer => ({ id: "boat", asset: "boat", label: "Boat", x, y, width: 34, height: 40, visible });
const waves: StoryLayer = { id: "waves", asset: "waves", label: "Waves", x: -5, y: 71, width: 110, height: 30, visible: true };

const JONAH: SchoolStory = {
  id: "jonah", title: "Jonah and the Great Fish", reference: "Jonah 1",
  scenes: [
    { title: "God calls Jonah", background: "land",
      teacherText: "One day God told Jonah to go to the great city of Nineveh. God had a message for the people there.",
      layers: [person(20, 50, false), { id: "city", asset: "city", label: "Nineveh", x: 65, y: 28, width: 27, height: 48, visible: false }],
      cues: [
        { label: "Jonah appears", actions: [{ op: "show", target: "jonah" }, { op: "playAudio", sound: "entrance" }] },
        { label: "Show Nineveh", teacherText: "God said, ‘Go to Nineveh.’ Can you point to the city?", actions: [{ op: "show", target: "city" }] },
      ],
    },
    { title: "Jonah runs away", background: "harbour", audio: "harbour",
      teacherText: "But Jonah didn't want to go. He went down to the harbour and found a ship going the other way.",
      layers: [boat(105, 37, false), person(14, 38), waves],
      cues: [
        { label: "Boat slides in", actions: [{ op: "show", target: "boat" }, { op: "move", target: "boat", x: 50, y: 37 }] },
        { label: "Jonah climbs aboard", teacherText: "Jonah climbed aboard. He thought he could run away from God. Can anyone hide from God?", actions: [{ op: "move", target: "jonah", x: 61, y: 34 }] },
      ],
    },
    { title: "The storm", background: "sea",
      teacherText: "Then God sent a great wind. The sea became rough. The sailors were frightened!",
      layers: [{ id: "clouds", asset: "clouds", label: "Storm clouds", x: 0, y: 0, width: 100, height: 40, visible: false }, boat(34, 35), person(47, 30), waves],
      cues: [
        { label: "Dark clouds gather", actions: [{ op: "show", target: "clouds" }] },
        { label: "Waves begin to roll", teacherText: "The waves rose higher. Let's all sway like the waves!", actions: [{ op: "bounce", target: "waves" }, { op: "bounce", target: "boat" }, { op: "playAudio", sound: "waves" }] },
        { label: "Thunder!", teacherText: "What a storm! Jonah knew he had run away from God.", actions: [{ op: "shake", target: "boat" }, { op: "playAudio", sound: "thunder" }] },
      ],
    },
    { title: "Into the sea", background: "storm",
      teacherText: "Jonah told the sailors, ‘Throw me into the sea, and it will become calm.’ They tried hard to row to land, but they couldn't.",
      layers: [boat(18, 30), person(30, 25), waves, { id: "fish", asset: "fish", label: "Great fish", x: 110, y: 54, width: 42, height: 35, visible: false }],
      cues: [
        { label: "Jonah goes overboard", actions: [{ op: "move", target: "jonah", x: 57, y: 62, rotation: 55 }] },
        { label: "Splash!", teacherText: "Splash! Jonah went into the sea. And the great storm stopped.", actions: [{ op: "playAudio", sound: "splash" }] },
        { label: "A great fish arrives", teacherText: "God had prepared a great fish. God had not forgotten Jonah!", actions: [{ op: "show", target: "fish" }, { op: "move", target: "fish", x: 50, y: 54 }] },
        { label: "The fish swallows Jonah", teacherText: "The fish swallowed Jonah. Inside the fish, Jonah would pray to God.", actions: [{ op: "hide", target: "jonah" }, { op: "playAudio", sound: "pop" }] },
        { label: "The fish swims away", teacherText: "Even in the deep sea, God was with Jonah. That's where we'll leave the story today.", actions: [{ op: "move", target: "fish", x: -48, y: 62 }] },
      ],
    },
  ],
};

export const SCHOOL_STORIES: Record<string, SchoolStory> = { [JONAH.id]: JONAH };

export function storyLength(story: SchoolStory) {
  return story.scenes.reduce((total, scene) => total + 1 + scene.cues.length, 0);
}

// Rebuild a frame from data, never from animation history. Back, reconnect and
// unblank therefore restore the same scene even after a skipped poll.
export function storyFrame(story: SchoolStory, step: number) {
  let remaining = Math.max(0, Math.min(step, storyLength(story) - 1));
  let sceneIndex = 0;
  while (remaining > story.scenes[sceneIndex].cues.length) {
    remaining -= story.scenes[sceneIndex].cues.length + 1;
    sceneIndex++;
  }
  const scene = story.scenes[sceneIndex];
  const layers = scene.layers.map((layer) => ({ ...layer }));
  let teacherText = scene.teacherText;
  for (const cue of scene.cues.slice(0, remaining)) {
    teacherText = cue.teacherText ?? teacherText;
    for (const action of cue.actions) {
      if (action.op === "playAudio") continue;
      const layer = layers.find((candidate) => candidate.id === action.target);
      if (!layer) continue;
      if (action.op === "show" || action.op === "hide") layer.visible = action.op === "show";
      if (action.op === "move") { layer.x = action.x; layer.y = action.y; layer.rotation = action.rotation ?? 0; }
      if (action.op === "bounce" || action.op === "shake") layer.motion = action.op;
    }
  }
  const last = scene.cues[remaining - 1];
  const audioAction = last?.actions.find((action) => action.op === "playAudio");
  return { scene, sceneIndex, layers, teacherText,
    sound: remaining === 0 ? scene.audio : audioAction?.op === "playAudio" ? audioAction.sound : undefined,
    next: scene.cues[remaining]?.label ?? story.scenes[sceneIndex + 1]?.title ?? "Finish story",
  };
}
