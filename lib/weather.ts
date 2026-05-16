export async function getWeather(
  location: string | { lat: number; lon: number }
): Promise<string> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return '';

  const q = typeof location === 'string'
    ? `q=${encodeURIComponent(location)}`
    : `lat=${location.lat}&lon=${location.lon}`;

  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?${q}&appid=${key}&units=metric`
  );
  if (!res.ok) return '';

  const d = await res.json();
  return `${d.name}, ${d.sys?.country}: ${d.weather[0]?.description}, ${Math.round(d.main.temp)}°C (feels like ${Math.round(d.main.feels_like)}°C), humidity ${d.main.humidity}%, wind ${d.wind.speed} m/s`;
}
