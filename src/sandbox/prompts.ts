// Sandbox-only prompts. Deliberately NOT the game's prompt pool: that lives
// server-side only (server/src/game/promptPool.ts) so its vocabulary never
// ships to players, who could otherwise recognize the real prompt during
// GUESS. These avoid the pool's words entirely — they just need to be fun to
// build and to give the prompt-word search tabs something to find.
export const SANDBOX_PROMPTS: readonly string[] = [
  'Penguin Astronaut on the Moon',
  'Giraffe Wearing a Scarf at the Beach',
  'Cat Conducting an Orchestra',
  'Turtle Delivering Pizza in the Rain',
  'Parrot Reading a Newspaper on a Bench',
  'Horse Losing at Chess in a Library',
  'Fox Knitting a Sweater by the Fireplace',
  'Bear with a Balloon at the Circus',
  'Dog Skateboarding Past a Castle',
  'Rabbit Painting a Portrait in the Museum',
  'Elephant Balancing on a Bicycle',
  'Pig Wearing a Tuxedo at the Opera',
  'Squirrel Steering a Sailboat',
  'Kangaroo with an Umbrella in the Snowstorm',
  'Hedgehog Baking Bread in a Bakery',
  'Octopus Pianist Underwater',
  'Zebra Walking a Dog in the Park',
  'Raccoon Mayor Giving a Speech',
  'Dinosaur at the Laundromat',
  'Hamster Driving a Tractor on the Farm',
  'Walrus with a Telescope on the Glacier',
  'Monkey Barber Cutting Hair',
  'Panda Wearing a Tiara at the Ballet',
  'Chicken Detective with a Magnifying Glass',
  'Camel in a Phone Booth',
  'Koala on a Surfboard at Sunset',
  'Moose at the Bowling Alley',
  'Peacock Painting Fingernails',
  'Lobster Waiter Serving Spaghetti',
  'Tiger Watering Tulips in the Greenhouse',
]
