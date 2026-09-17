export const PROMPTS: readonly string[] = [
  'Vampire Bunny Hotel Reception',
  'Disgraced Wizard Applying for Unemployment',
  'Octopus DJ at a Silent Disco',
  'Medieval Knight Doing Taxes',
  'Astronaut Allergic to Space',
  'Pirate Captain of a Rubber Duck Fleet',
  'Grandma Winning an Illegal Street Race',
  'Dinosaur Working the Night Shift at a Diner',
  'Ghost Trying to Return an Overdue Library Book',
  'Robot Learning to Ride a Unicycle',
]

// placeholder only — real prompts will come from the server later
export function randomPrompt(): string {
  const index = Math.floor(Math.random() * PROMPTS.length)
  return PROMPTS[index] ?? 'Untitled Prompt'
}
