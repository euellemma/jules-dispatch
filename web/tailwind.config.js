/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2f7ee7", // Blue primary
        "primary-hover": "#1e6fd6",
      },
    },
  },
  plugins: [],
}

