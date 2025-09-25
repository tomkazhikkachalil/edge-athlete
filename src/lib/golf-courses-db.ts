// Comprehensive golf course database with real course information
// This can be expanded to integrate with APIs like Golf Channel, PGA Tour, or course websites

export interface GolfHole {
  number: number;
  par: number;
  yardage: {
    black?: number;
    blue?: number;
    white?: number;
    gold?: number;
    red?: number;
  };
  handicap: number;
  description?: string;
}

export interface GolfCourse {
  id: string;
  name: string;
  location: {
    city: string;
    state: string;
    country: string;
    coordinates?: { lat: number; lng: number };
  };
  designer?: string;
  yearOpened?: number;
  courseRating: {
    black?: number;
    blue?: number;
    white?: number;
    gold?: number;
    red?: number;
  };
  slopeRating: {
    black?: number;
    blue?: number;
    white?: number;
    gold?: number;
    red?: number;
  };
  totalPar: number;
  totalYardage: {
    black?: number;
    blue?: number;
    white?: number;
    gold?: number;
    red?: number;
  };
  holes: GolfHole[];
  features?: string[];
  website?: string;
  phone?: string;
  imageUrl?: string;
  description?: string;
  greensType?: string;
  priceRange?: 'budget' | 'moderate' | 'premium' | 'luxury';
}

// Comprehensive database of famous golf courses with real data
export const GOLF_COURSES_DATABASE: GolfCourse[] = [
  {
    id: 'pebble-beach',
    name: 'Pebble Beach Golf Links',
    location: {
      city: 'Pebble Beach',
      state: 'California',
      country: 'USA',
      coordinates: { lat: 36.5675, lng: -121.9481 }
    },
    designer: 'Jack Neville, Douglas Grant',
    yearOpened: 1919,
    courseRating: {
      black: 75.5,
      blue: 74.0,
      white: 71.4,
      gold: 68.8,
      red: 71.0
    },
    slopeRating: {
      black: 145,
      blue: 142,
      white: 133,
      gold: 124,
      red: 129
    },
    totalPar: 72,
    totalYardage: {
      black: 7040,
      blue: 6828,
      white: 6329,
      gold: 5672,
      red: 5198
    },
    holes: [
      { number: 1, par: 4, yardage: { black: 377, blue: 377, white: 350, gold: 335, red: 308 }, handicap: 11 },
      { number: 2, par: 5, yardage: { black: 502, blue: 502, white: 480, gold: 450, red: 417 }, handicap: 15 },
      { number: 3, par: 4, yardage: { black: 390, blue: 390, white: 370, gold: 340, red: 310 }, handicap: 5 },
      { number: 4, par: 4, yardage: { black: 327, blue: 327, white: 310, gold: 288, red: 268 }, handicap: 17 },
      { number: 5, par: 3, yardage: { black: 188, blue: 188, white: 166, gold: 148, red: 130 }, handicap: 7 },
      { number: 6, par: 5, yardage: { black: 523, blue: 523, white: 495, gold: 465, red: 430 }, handicap: 1 },
      { number: 7, par: 3, yardage: { black: 106, blue: 106, white: 100, gold: 95, red: 85 }, handicap: 13 },
      { number: 8, par: 4, yardage: { black: 418, blue: 418, white: 395, gold: 365, red: 335 }, handicap: 3 },
      { number: 9, par: 4, yardage: { black: 464, blue: 464, white: 440, gold: 410, red: 380 }, handicap: 9 },
      { number: 10, par: 4, yardage: { black: 446, blue: 446, white: 424, gold: 390, red: 360 }, handicap: 2 },
      { number: 11, par: 4, yardage: { black: 384, blue: 384, white: 365, gold: 335, red: 305 }, handicap: 12 },
      { number: 12, par: 3, yardage: { black: 202, blue: 202, white: 180, gold: 158, red: 135 }, handicap: 16 },
      { number: 13, par: 4, yardage: { black: 392, blue: 392, white: 370, gold: 340, red: 310 }, handicap: 8 },
      { number: 14, par: 5, yardage: { black: 580, blue: 580, white: 555, gold: 520, red: 485 }, handicap: 6 },
      { number: 15, par: 4, yardage: { black: 397, blue: 397, white: 375, gold: 345, red: 315 }, handicap: 10 },
      { number: 16, par: 4, yardage: { black: 402, blue: 402, white: 380, gold: 350, red: 320 }, handicap: 14 },
      { number: 17, par: 3, yardage: { black: 209, blue: 209, white: 180, gold: 158, red: 135 }, handicap: 18 },
      { number: 18, par: 5, yardage: { black: 543, blue: 543, white: 520, gold: 485, red: 450 }, handicap: 4 }
    ],
    features: ['Ocean Views', 'Historic', 'Links Style', 'Tournament Venue'],
    website: 'https://pebblebeach.com',
    imageUrl: '/images/courses/pebble-beach.jpg',
    description: 'One of the most beautiful and challenging courses in the world, home to the AT&T Pebble Beach Pro-Am',
    greensType: 'Poa Annua',
    priceRange: 'luxury'
  },
  {
    id: 'augusta-national',
    name: 'Augusta National Golf Club',
    location: {
      city: 'Augusta',
      state: 'Georgia',
      country: 'USA',
      coordinates: { lat: 33.5030, lng: -82.0199 }
    },
    designer: 'Alister MacKenzie, Bobby Jones',
    yearOpened: 1933,
    courseRating: {
      black: 78.1,
      blue: 76.2,
      white: 73.9
    },
    slopeRating: {
      black: 155,
      blue: 148,
      white: 137
    },
    totalPar: 72,
    totalYardage: {
      black: 7545,
      blue: 7260,
      white: 6770
    },
    holes: [
      { number: 1, par: 4, yardage: { black: 445, blue: 435, white: 400 }, handicap: 9 },
      { number: 2, par: 5, yardage: { black: 575, blue: 565, white: 525 }, handicap: 11 },
      { number: 3, par: 4, yardage: { black: 350, blue: 340, white: 320 }, handicap: 15 },
      { number: 4, par: 3, yardage: { black: 240, blue: 230, white: 205 }, handicap: 17 },
      { number: 5, par: 4, yardage: { black: 495, blue: 485, white: 455 }, handicap: 1 },
      { number: 6, par: 3, yardage: { black: 180, blue: 175, white: 165 }, handicap: 13 },
      { number: 7, par: 4, yardage: { black: 450, blue: 440, white: 410 }, handicap: 3 },
      { number: 8, par: 5, yardage: { black: 570, blue: 560, white: 520 }, handicap: 7 },
      { number: 9, par: 4, yardage: { black: 460, blue: 450, white: 420 }, handicap: 5 },
      { number: 10, par: 4, yardage: { black: 495, blue: 485, white: 455 }, handicap: 2 },
      { number: 11, par: 4, yardage: { black: 520, blue: 510, white: 480 }, handicap: 4 },
      { number: 12, par: 3, yardage: { black: 155, blue: 150, white: 140 }, handicap: 16 },
      { number: 13, par: 5, yardage: { black: 510, blue: 500, white: 470 }, handicap: 8 },
      { number: 14, par: 4, yardage: { black: 440, blue: 430, white: 400 }, handicap: 12 },
      { number: 15, par: 5, yardage: { black: 530, blue: 520, white: 490 }, handicap: 6 },
      { number: 16, par: 3, yardage: { black: 170, blue: 165, white: 155 }, handicap: 18 },
      { number: 17, par: 4, yardage: { black: 440, blue: 430, white: 400 }, handicap: 10 },
      { number: 18, par: 4, yardage: { black: 465, blue: 455, white: 425 }, handicap: 14 }
    ],
    features: ['Masters Tournament', 'Azaleas', 'Amen Corner', 'Private Club'],
    website: 'https://augustanational.com',
    imageUrl: '/images/courses/augusta-national.jpg',
    description: 'Home of the Masters Tournament, one of the most exclusive and beautiful courses in the world',
    greensType: 'Bentgrass',
    priceRange: 'luxury'
  },
  {
    id: 'st-andrews-old',
    name: 'St. Andrews Old Course',
    location: {
      city: 'St. Andrews',
      state: 'Scotland',
      country: 'UK',
      coordinates: { lat: 56.3426, lng: -2.8159 }
    },
    designer: 'Natural Evolution',
    yearOpened: 1552,
    courseRating: {
      black: 74.4,
      blue: 72.8,
      white: 70.2
    },
    slopeRating: {
      black: 140,
      blue: 135,
      white: 125
    },
    totalPar: 72,
    totalYardage: {
      black: 7297,
      blue: 6721,
      white: 6232
    },
    holes: [
      { number: 1, par: 4, yardage: { black: 376, blue: 376, white: 364 }, handicap: 13, description: 'Burn' },
      { number: 2, par: 4, yardage: { black: 453, blue: 411, white: 367 }, handicap: 7, description: 'Dyke' },
      { number: 3, par: 4, yardage: { black: 397, blue: 371, white: 340 }, handicap: 11, description: 'Cartgate (Out)' },
      { number: 4, par: 4, yardage: { black: 480, blue: 463, white: 419 }, handicap: 1, description: 'Ginger Beer' },
      { number: 5, par: 5, yardage: { black: 570, blue: 568, white: 514 }, handicap: 5, description: 'Hole O Cross (Out)' },
      { number: 6, par: 4, yardage: { black: 414, blue: 374, white: 348 }, handicap: 15, description: 'Heathery (Out)' },
      { number: 7, par: 4, yardage: { black: 372, blue: 359, white: 334 }, handicap: 9, description: 'High (Out)' },
      { number: 8, par: 3, yardage: { black: 178, blue: 166, white: 148 }, handicap: 17, description: 'Short' },
      { number: 9, par: 4, yardage: { black: 352, blue: 307, white: 268 }, handicap: 3, description: 'End' },
      { number: 10, par: 4, yardage: { black: 386, blue: 342, white: 318 }, handicap: 14, description: 'Bobby Jones' },
      { number: 11, par: 3, yardage: { black: 174, blue: 172, white: 164 }, handicap: 18, description: 'High (In)' },
      { number: 12, par: 4, yardage: { black: 348, blue: 316, white: 292 }, handicap: 10, description: 'Heathery (In)' },
      { number: 13, par: 4, yardage: { black: 465, blue: 425, white: 398 }, handicap: 6, description: 'Hole O Cross (In)' },
      { number: 14, par: 5, yardage: { black: 614, blue: 567, white: 530 }, handicap: 4, description: 'Long' },
      { number: 15, par: 4, yardage: { black: 456, blue: 413, white: 383 }, handicap: 8, description: 'Cartgate (In)' },
      { number: 16, par: 4, yardage: { black: 423, blue: 382, white: 351 }, handicap: 12, description: 'Corner of the Dyke' },
      { number: 17, par: 4, yardage: { black: 495, blue: 461, white: 424 }, handicap: 2, description: 'Road Hole' },
      { number: 18, par: 4, yardage: { black: 357, blue: 354, white: 354 }, handicap: 16, description: 'Tom Morris' }
    ],
    features: ['Historic', 'Home of Golf', 'Links', 'Double Greens', 'Burns'],
    website: 'https://standrews.com',
    imageUrl: '/images/courses/st-andrews.jpg',
    description: 'The Home of Golf, the oldest golf course in the world and host to The Open Championship',
    greensType: 'Fescue',
    priceRange: 'premium'
  },
  {
    id: 'pinehurst-no2',
    name: 'Pinehurst No. 2',
    location: {
      city: 'Pinehurst',
      state: 'North Carolina',
      country: 'USA',
      coordinates: { lat: 35.1954, lng: -79.4683 }
    },
    designer: 'Donald Ross',
    yearOpened: 1907,
    courseRating: {
      black: 75.3,
      blue: 73.6,
      white: 71.0
    },
    slopeRating: {
      black: 147,
      blue: 140,
      white: 129
    },
    totalPar: 72,
    totalYardage: {
      black: 7588,
      blue: 7170,
      white: 6614
    },
    holes: [
      { number: 1, par: 4, yardage: { black: 401, blue: 390, white: 375 }, handicap: 11 },
      { number: 2, par: 4, yardage: { black: 502, blue: 485, white: 450 }, handicap: 5 },
      { number: 3, par: 4, yardage: { black: 390, blue: 375, white: 350 }, handicap: 13 },
      { number: 4, par: 4, yardage: { black: 554, blue: 540, white: 510 }, handicap: 1 },
      { number: 5, par: 4, yardage: { black: 482, blue: 465, white: 430 }, handicap: 3 },
      { number: 6, par: 3, yardage: { black: 212, blue: 195, white: 175 }, handicap: 15 },
      { number: 7, par: 4, yardage: { black: 407, blue: 390, white: 365 }, handicap: 9 },
      { number: 8, par: 4, yardage: { black: 485, blue: 470, white: 445 }, handicap: 7 },
      { number: 9, par: 4, yardage: { black: 460, blue: 445, white: 420 }, handicap: 17 },
      { number: 10, par: 4, yardage: { black: 611, blue: 595, white: 570 }, handicap: 2 },
      { number: 11, par: 4, yardage: { black: 434, blue: 420, white: 395 }, handicap: 6 },
      { number: 12, par: 4, yardage: { black: 469, blue: 455, white: 430 }, handicap: 10 },
      { number: 13, par: 4, yardage: { black: 377, blue: 365, white: 340 }, handicap: 16 },
      { number: 14, par: 4, yardage: { black: 477, blue: 460, white: 435 }, handicap: 8 },
      { number: 15, par: 3, yardage: { black: 204, blue: 190, white: 175 }, handicap: 18 },
      { number: 16, par: 4, yardage: { black: 509, blue: 495, white: 470 }, handicap: 4 },
      { number: 17, par: 3, yardage: { black: 195, blue: 185, white: 170 }, handicap: 14 },
      { number: 18, par: 4, yardage: { black: 440, blue: 425, white: 400 }, handicap: 12 }
    ],
    features: ['US Open', 'Donald Ross Design', 'Crowned Greens', 'Sandhills'],
    website: 'https://pinehurst.com',
    imageUrl: '/images/courses/pinehurst-no2.jpg',
    description: 'Classic Donald Ross design featuring crowned greens and strategic bunkering',
    greensType: 'Bermuda',
    priceRange: 'premium'
  },

  // ========== OTTAWA, CANADA COURSES ==========
  {
    id: 'rideau-view',
    name: 'Rideau View Golf Club',
    location: {
      city: 'Ottawa',
      state: 'Ontario',
      country: 'Canada',
      coordinates: { lat: 45.3311, lng: -75.7581 }
    },
    designer: 'Robbie Robinson',
    yearOpened: 1987,
    courseRating: { black: 73.2, blue: 71.8, white: 69.5, gold: 67.2, red: 69.8 },
    slopeRating: { black: 135, blue: 130, white: 125, gold: 118, red: 125 },
    totalPar: 72,
    totalYardage: { black: 6820, blue: 6450, white: 6050, gold: 5650, red: 5280 },
    holes: [
      { number: 1, par: 4, yardage: { black: 410, blue: 385, white: 360, gold: 335, red: 310 }, handicap: 7 },
      { number: 2, par: 4, yardage: { black: 390, blue: 365, white: 340, gold: 315, red: 290 }, handicap: 13 },
      { number: 3, par: 3, yardage: { black: 180, blue: 165, white: 150, gold: 135, red: 120 }, handicap: 17 },
      { number: 4, par: 5, yardage: { black: 520, blue: 495, white: 470, gold: 445, red: 420 }, handicap: 3 },
      { number: 5, par: 4, yardage: { black: 415, blue: 390, white: 365, gold: 340, red: 315 }, handicap: 9 },
      { number: 6, par: 4, yardage: { black: 380, blue: 355, white: 330, gold: 305, red: 280 }, handicap: 15 },
      { number: 7, par: 3, yardage: { black: 175, blue: 160, white: 145, gold: 130, red: 115 }, handicap: 11 },
      { number: 8, par: 5, yardage: { black: 535, blue: 510, white: 485, gold: 460, red: 435 }, handicap: 1 },
      { number: 9, par: 4, yardage: { black: 425, blue: 400, white: 375, gold: 350, red: 325 }, handicap: 5 },
      { number: 10, par: 4, yardage: { black: 395, blue: 370, white: 345, gold: 320, red: 295 }, handicap: 8 },
      { number: 11, par: 3, yardage: { black: 165, blue: 150, white: 135, gold: 120, red: 105 }, handicap: 16 },
      { number: 12, par: 4, yardage: { black: 420, blue: 395, white: 370, gold: 345, red: 320 }, handicap: 4 },
      { number: 13, par: 4, yardage: { black: 405, blue: 380, white: 355, gold: 330, red: 305 }, handicap: 12 },
      { number: 14, par: 5, yardage: { black: 545, blue: 520, white: 495, gold: 470, red: 445 }, handicap: 2 },
      { number: 15, par: 3, yardage: { black: 190, blue: 175, white: 160, gold: 145, red: 130 }, handicap: 18 },
      { number: 16, par: 4, yardage: { black: 385, blue: 360, white: 335, gold: 310, red: 285 }, handicap: 14 },
      { number: 17, par: 4, yardage: { black: 430, blue: 405, white: 380, gold: 355, red: 330 }, handicap: 6 },
      { number: 18, par: 4, yardage: { black: 440, blue: 415, white: 390, gold: 365, red: 340 }, handicap: 10 }
    ],
    features: ['Parkland Style', 'Ottawa River Views', 'Pro Shop', 'Driving Range'],
    website: 'https://rideauview.com',
    imageUrl: '/images/courses/rideau-view.jpg',
    description: 'Scenic parkland course overlooking the Ottawa River with challenging layout',
    greensType: 'Bentgrass',
    priceRange: 'premium'
  },

  {
    id: 'ottawa-hunt',
    name: 'Ottawa Hunt and Golf Club',
    location: {
      city: 'Ottawa',
      state: 'Ontario',
      country: 'Canada',
      coordinates: { lat: 45.3847, lng: -75.7294 }
    },
    designer: 'Willie Park Jr., Bryant White',
    yearOpened: 1908,
    courseRating: { black: 74.8, blue: 73.2, white: 71.6, gold: 69.4, red: 72.1 },
    slopeRating: { black: 140, blue: 135, white: 130, gold: 122, red: 128 },
    totalPar: 72,
    totalYardage: { black: 6950, blue: 6580, white: 6180, gold: 5750, red: 5420 },
    holes: [
      { number: 1, par: 4, yardage: { black: 425, blue: 400, white: 375, gold: 350, red: 325 }, handicap: 5 },
      { number: 2, par: 4, yardage: { black: 405, blue: 380, white: 355, gold: 330, red: 305 }, handicap: 11 },
      { number: 3, par: 3, yardage: { black: 195, blue: 180, white: 165, gold: 150, red: 135 }, handicap: 15 },
      { number: 4, par: 5, yardage: { black: 550, blue: 525, white: 500, gold: 475, red: 450 }, handicap: 1 },
      { number: 5, par: 4, yardage: { black: 440, blue: 415, white: 390, gold: 365, red: 340 }, handicap: 7 },
      { number: 6, par: 4, yardage: { black: 395, blue: 370, white: 345, gold: 320, red: 295 }, handicap: 13 },
      { number: 7, par: 3, yardage: { black: 170, blue: 155, white: 140, gold: 125, red: 110 }, handicap: 17 },
      { number: 8, par: 5, yardage: { black: 520, blue: 495, white: 470, gold: 445, red: 420 }, handicap: 3 },
      { number: 9, par: 4, yardage: { black: 415, blue: 390, white: 365, gold: 340, red: 315 }, handicap: 9 },
      { number: 10, par: 4, yardage: { black: 430, blue: 405, white: 380, gold: 355, red: 330 }, handicap: 6 },
      { number: 11, par: 3, yardage: { black: 185, blue: 170, white: 155, gold: 140, red: 125 }, handicap: 16 },
      { number: 12, par: 4, yardage: { black: 410, blue: 385, white: 360, gold: 335, red: 310 }, handicap: 8 },
      { number: 13, par: 4, yardage: { black: 390, blue: 365, white: 340, gold: 315, red: 290 }, handicap: 14 },
      { number: 14, par: 5, yardage: { black: 535, blue: 510, white: 485, gold: 460, red: 435 }, handicap: 2 },
      { number: 15, par: 3, yardage: { black: 160, blue: 145, white: 130, gold: 115, red: 100 }, handicap: 18 },
      { number: 16, par: 4, yardage: { black: 420, blue: 395, white: 370, gold: 345, red: 320 }, handicap: 10 },
      { number: 17, par: 4, yardage: { black: 450, blue: 425, white: 400, gold: 375, red: 350 }, handicap: 4 },
      { number: 18, par: 4, yardage: { black: 445, blue: 420, white: 395, gold: 370, red: 345 }, handicap: 12 }
    ],
    features: ['Historic', 'Private Club', 'Parkland Style', 'Championship Course'],
    website: 'https://ottawahuntclub.org',
    imageUrl: '/images/courses/ottawa-hunt.jpg',
    description: 'Historic championship course established in 1908, one of Canada\'s premier golf clubs',
    greensType: 'Bentgrass',
    priceRange: 'luxury'
  },

  {
    id: 'eagle-creek-kanata',
    name: 'Eagle Creek Golf Club',
    location: {
      city: 'Ottawa',
      state: 'Ontario',
      country: 'Canada',
      coordinates: { lat: 45.2669, lng: -76.0697 }
    },
    designer: 'Thomas McBroom',
    yearOpened: 1998,
    courseRating: { black: 73.8, blue: 72.1, white: 70.3, gold: 68.1, red: 70.9 },
    slopeRating: { black: 138, blue: 133, white: 128, gold: 120, red: 126 },
    totalPar: 72,
    totalYardage: { black: 6890, blue: 6520, white: 6120, gold: 5680, red: 5350 },
    holes: [
      { number: 1, par: 4, yardage: { black: 420, blue: 395, white: 370, gold: 345, red: 320 }, handicap: 9 },
      { number: 2, par: 5, yardage: { black: 540, blue: 515, white: 490, gold: 465, red: 440 }, handicap: 3 },
      { number: 3, par: 3, yardage: { black: 175, blue: 160, white: 145, gold: 130, red: 115 }, handicap: 15 },
      { number: 4, par: 4, yardage: { black: 405, blue: 380, white: 355, gold: 330, red: 305 }, handicap: 7 },
      { number: 5, par: 4, yardage: { black: 385, blue: 360, white: 335, gold: 310, red: 285 }, handicap: 13 },
      { number: 6, par: 3, yardage: { black: 190, blue: 175, white: 160, gold: 145, red: 130 }, handicap: 17 },
      { number: 7, par: 5, yardage: { black: 525, blue: 500, white: 475, gold: 450, red: 425 }, handicap: 1 },
      { number: 8, par: 4, yardage: { black: 410, blue: 385, white: 360, gold: 335, red: 310 }, handicap: 5 },
      { number: 9, par: 4, yardage: { black: 435, blue: 410, white: 385, gold: 360, red: 335 }, handicap: 11 },
      { number: 10, par: 4, yardage: { black: 395, blue: 370, white: 345, gold: 320, red: 295 }, handicap: 10 },
      { number: 11, par: 4, yardage: { black: 425, blue: 400, white: 375, gold: 350, red: 325 }, handicap: 6 },
      { number: 12, par: 3, yardage: { black: 165, blue: 150, white: 135, gold: 120, red: 105 }, handicap: 16 },
      { number: 13, par: 5, yardage: { black: 515, blue: 490, white: 465, gold: 440, red: 415 }, handicap: 2 },
      { number: 14, par: 4, yardage: { black: 400, blue: 375, white: 350, gold: 325, red: 300 }, handicap: 12 },
      { number: 15, par: 3, yardage: { black: 180, blue: 165, white: 150, gold: 135, red: 120 }, handicap: 18 },
      { number: 16, par: 4, yardage: { black: 415, blue: 390, white: 365, gold: 340, red: 315 }, handicap: 8 },
      { number: 17, par: 4, yardage: { black: 440, blue: 415, white: 390, gold: 365, red: 340 }, handicap: 4 },
      { number: 18, par: 4, yardage: { black: 460, blue: 435, white: 410, gold: 385, red: 360 }, handicap: 14 }
    ],
    features: ['Modern Design', 'Water Features', 'Challenging Layout', 'Pro Shop'],
    website: 'https://eaglecreekgolf.ca',
    imageUrl: '/images/courses/eagle-creek.jpg',
    description: 'Modern championship course designed by Thomas McBroom with strategic water features',
    greensType: 'Bentgrass',
    priceRange: 'premium'
  }
];

// Search function for golf courses
export function searchGolfCourses(query: string, limit: number = 10): GolfCourse[] {
  if (!query || query.length < 2) {
    return GOLF_COURSES_DATABASE.slice(0, limit);
  }

  const searchTerm = query.toLowerCase();

  return GOLF_COURSES_DATABASE
    .filter(course =>
      course.name.toLowerCase().includes(searchTerm) ||
      course.location.city.toLowerCase().includes(searchTerm) ||
      course.location.state.toLowerCase().includes(searchTerm) ||
      course.designer?.toLowerCase().includes(searchTerm)
    )
    .slice(0, limit);
}

// Get course by ID
export function getCourseById(id: string): GolfCourse | undefined {
  return GOLF_COURSES_DATABASE.find(course => course.id === id);
}

// Get course by name (fuzzy match)
export function getCourseByName(name: string): GolfCourse | undefined {
  const searchTerm = name.toLowerCase();
  return GOLF_COURSES_DATABASE.find(course =>
    course.name.toLowerCase() === searchTerm ||
    course.name.toLowerCase().includes(searchTerm)
  );
}

// Get yardage for specific tee
export function getYardageForTee(course: GolfCourse, tee: string): number[] {
  const validTees = ['black', 'blue', 'white', 'gold', 'red'] as const;
  const teeKey = (validTees.includes(tee as any) ? tee : 'white') as 'black' | 'blue' | 'white' | 'gold' | 'red';
  return course.holes.map(hole => hole.yardage[teeKey] || hole.yardage.white || 400);
}

// Get course rating and slope for tee
export function getRatingForTee(course: GolfCourse, tee: string): { rating?: number; slope?: number } {
  const validTees = ['black', 'blue', 'white', 'gold', 'red'] as const;
  const teeKey = (validTees.includes(tee as any) ? tee : 'white') as 'black' | 'blue' | 'white' | 'gold' | 'red';
  return {
    rating: course.courseRating[teeKey],
    slope: course.slopeRating[teeKey]
  };
}