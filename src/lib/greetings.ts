export interface GreetingData {
  [key: string]: {
    [key: string]: string[];
  };
}

export const kishoGreetings: GreetingData = {
  monday: {
    morning: [
      "Good morning, Raman — caffeine's on the left, inspiration's on the right.",
      "Monday's here — let's turn that weekend spark into a patent-worthy flame.",
      "Morning reset: coffee brewing, ideas flowing, Kisho coding."
    ],
    afternoon: [
      "Monday's half gone — shall we outsmart it before it notices?",
      "Afternoon momentum building — what brilliant idea shall we chase today?",
      "Your Monday brain is firing on all cylinders — let's capture that energy."
    ],
    evening: [
      "You survived Monday. That itself deserves a patent.",
      "Evening reflection: what idea lit up your Monday? Let's nurture it.",
      "Monday's winding down — perfect time to plant seeds for Tuesday's harvest."
    ]
  },
  tuesday: {
    morning: [
      "Tuesday: statistically 23% more productive than Monday. Let's prove that right.",
      "Good morning — your Tuesday brain is optimized for breakthroughs.",
      "Tuesday's clarity window — what shall we invent today?"
    ],
    afternoon: [
      "The world's still catching up with your Monday ideas — let's make them jealous.",
      "Tuesday's sweet spot — focused energy, creative flow.",
      "Afternoon innovation hour — what's brewing in that brilliant mind?"
    ],
    evening: [
      "Evening check: one brain, zero coffee left, infinite potential remaining.",
      "Tuesday's momentum is yours — what ground did we cover today?",
      "Your creativity curve is peaking — even algorithms are applauding."
    ]
  },
  wednesday: {
    morning: [
      "It's midweek — let's weave something so smart it makes Friday nervous.",
      "Wednesday wisdom: the best ideas come from focused calm.",
      "Morning clarity — what innovation shall we bring to life today?"
    ],
    afternoon: [
      "Halfway there! I suggest ideas, you provide genius. Deal?",
      "Wednesday's creative peak — let's capture this golden hour.",
      "Afternoon focus: sharp mind, endless possibilities."
    ],
    evening: [
      "Wednesday's ending. Perfect time to patent your patience.",
      "Evening review: what ideas gained momentum today?",
      "Midweek reflection — your innovation journey continues beautifully."
    ]
  },
  thursday: {
    morning: [
      "Good morning — nearly Friday, but let's act like visionaries, not survivors.",
      "Thursday's breakthrough zone — what shall we revolutionize today?",
      "Morning momentum — your Thursday brain is primed for brilliance."
    ],
    afternoon: [
      "Thursday's the secret lab of the week — quiet, focused, and slightly weird.",
      "Afternoon innovation: where brilliant minds meet endless possibility.",
      "Your focus is legendary today — what shall we create?"
    ],
    evening: [
      "Your creativity curve peaked today. Even algorithms are applauding.",
      "Thursday evening: harvest time for this week's innovations.",
      "The week's wisdom is yours — what insights shall we preserve?"
    ]
  },
  friday: {
    morning: [
      "Friday's here — don't let your genius sign out early.",
      "Morning brilliance — let's make this Friday unforgettable.",
      "Friday's creative window — what masterpiece shall we begin?"
    ],
    afternoon: [
      "Almost weekend. Shall we sneak in one more 'Eureka!' before Netflix?",
      "Friday afternoon magic — your mind is at its most inventive.",
      "The week's culmination — what final innovation shall we launch?"
    ],
    evening: [
      "Closing time? Or opening time for side projects no one asked for?",
      "Friday evening reflection — what ground did we conquer this week?",
      "Weekend approaches, but innovation never sleeps — what shall we dream up?"
    ]
  },
  saturday: {
    morning: [
      "It's Saturday! No meetings, just meaning.",
      "Weekend morning clarity — what shall we build today?",
      "Saturday's freedom — unlimited creative space awaits."
    ],
    afternoon: [
      "Relaxed mind = better ideas. I call it 'research' if anyone asks.",
      "Saturday afternoon flow — where creativity meets serenity.",
      "Weekend innovation time — what new world shall we invent?"
    ],
    evening: [
      "Evening vibes: light jazz, dark coffee, and one glowing patent draft.",
      "Saturday evening: harvest time for weekend inspirations.",
      "The day's winding down — what idea shall we carry into tomorrow?"
    ]
  },
  sunday: {
    morning: [
      "Sunday morning — technically a day off, but inspiration didn't get the memo.",
      "Weekend reflection — what shall we create today?",
      "Sunday's quiet power — where deep thoughts become reality."
    ],
    afternoon: [
      "Your thoughts are sunbathing. Let's give one of them a prototype.",
      "Sunday afternoon dreaming — the perfect time for big ideas.",
      "Weekend wisdom gathering — what innovation shall we nurture?"
    ],
    evening: [
      "Tomorrow's Monday. Let's outplan it tonight, quietly.",
      "Sunday evening: planting seeds for the week's harvest.",
      "The weekend's wisdom — what breakthrough shall we prepare?"
    ]
  }
};

export function getTimeSegment(): string {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 12) return 'morning'; // Late morning still morning
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 24) return 'evening';
  return 'evening'; // Default to evening for late night
}

export function getDayOfWeek(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = new Date().getDay();
  return days[today];
}

export function getRandomGreeting(): string {
  const day = getDayOfWeek();
  const timeSegment = getTimeSegment();
  const dayGreetings = kishoGreetings[day]?.[timeSegment] || [];

  if (dayGreetings.length === 0) {
    return "Welcome back to your creative workspace!";
  }

  const randomIndex = Math.floor(Math.random() * dayGreetings.length);
  return dayGreetings[randomIndex];
}

export function getCurrentTimeString(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}
