export const metadata = {
  title: 'Binance Futures HQ Signal Monitor',
  description: 'Order Block scanner with signal lifecycle — server-side cron',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
