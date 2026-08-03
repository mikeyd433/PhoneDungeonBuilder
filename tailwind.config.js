/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Spec §3 palette. The whole app runs warm and dark except the automap,
      // which runs cold and light — stepping between them should feel like
      // stepping out of the dungeon to check your map.
      colors: {
        depth: '#141010', // deepest shadow, background behind everything
        stone: '#2B241E', // wall base, warm not neutral
        'stone-lit': '#4A3D30', // wall under torchlight
        mortar: '#6B5A47', // carved edges, joins
        torch: '#E8A33D', // THE accent — lit torch, active state, recorded
        ember: '#B85C1E', // secondary warm, hover states
        cold: '#41525C', // unlit, unwritten, disabled — absence of torch
        parchment: '#E4D9BE', // narration plaque, primary text on dark
        grave: '#8C2F22', // endings, destructive actions, dead ends
        paper: '#D6E4EC', // automap background
        grid: '#8FB0C2', // automap grid lines
        ink: '#1F3A4A', // automap hand-drawn lines and lettering
      },
      fontFamily: {
        // Spec §3: three faces, each mapped to a material.
        carved: ['"Uncial Antiqua"', 'Georgia', 'serif'], // stone — caps, sparingly
        voice: ['Alegreya', 'Georgia', 'serif'], // the spoken word
        paper: ['"Architects Daughter"', 'Comic Sans MS', 'cursive'], // surveyor's pencil
      },
      fontSize: {
        // Spec §3 type scale: 12 / 14 / 16 / 20 / 28 / 40.
        xs: ['12px', { lineHeight: '1.4' }],
        sm: ['14px', { lineHeight: '1.45' }],
        base: ['16px', { lineHeight: '1.5' }],
        lg: ['20px', { lineHeight: '1.5' }], // narration, tablet legibility
        xl: ['28px', { lineHeight: '1.2', letterSpacing: '0.12em' }], // carved headers
        '2xl': ['40px', { lineHeight: '1.1', letterSpacing: '0.12em' }],
      },
    },
  },
  plugins: [],
}
