import './globals.css';

export const metadata = {
  title: 'BinarySpot Pro | Institutional Deriv Bot Suite',
  description: 'Automated high-frequency trading bot, digit statistics engine, and manual execution terminal for Deriv.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#080b11] text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
