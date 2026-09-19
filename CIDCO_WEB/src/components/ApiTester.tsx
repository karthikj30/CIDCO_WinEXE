'use client';

import { useState } from 'react';
import { readJson } from '@/lib/fetchJson';

export default function ApiTester() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('/api/reports');
  const [headers, setHeaders] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<{ status: number; statusText: string; data: any; time: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const startTime = Date.now();

    try {
      const fetchHeaders: HeadersInit = {
        'Content-Type': 'application/json',
      };

      headers.forEach(h => {
        if (h.key && h.value) {
          fetchHeaders[h.key] = h.value;
        }
      });

      const options: RequestInit = {
        method,
        headers: fetchHeaders,
      };

      if (method !== 'GET' && method !== 'HEAD' && body) {
        options.body = body;
      }

      const res = await fetch(url, options);
      const time = Date.now() - startTime;
      
      let data;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await readJson(res);
      } else {
        data = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        data,
        time,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }]);
  const removeHeader = (index: number) => setHeaders(headers.filter((_, i) => i !== index));
  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...headers];
    newHeaders[index][field] = value;
    setHeaders(newHeaders);
  };

  return (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">API Tester</h1>
        <p className="text-slate-500 mt-1">Test CIDCO endpoints directly from the dashboard.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-4">
          <select 
            value={method} 
            onChange={e => setMethod(e.target.value)}
            className="block w-32 rounded-lg border-slate-300 py-2 px-3 text-sm font-medium focus:border-cidco-500 focus:outline-none focus:ring-1 focus:ring-cidco-500 bg-white"
          >
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
          <input 
            type="text" 
            value={url} 
            onChange={e => setUrl(e.target.value)}
            placeholder="/api/..."
            className="block w-full rounded-lg border-slate-300 py-2 px-3 text-sm focus:border-cidco-500 focus:outline-none focus:ring-1 focus:ring-cidco-500"
          />
          <button 
            onClick={handleSend}
            disabled={loading}
            className="bg-cidco-600 hover:bg-cidco-700 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-slate-900">Headers</h3>
                <button onClick={addHeader} className="text-xs text-cidco-600 font-medium hover:underline">+ Add Header</button>
              </div>
              <div className="space-y-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Key" 
                      value={h.key}
                      onChange={e => updateHeader(i, 'key', e.target.value)}
                      className="block w-full rounded-md border-slate-300 py-1.5 px-3 text-sm"
                    />
                    <input 
                      type="text" 
                      placeholder="Value" 
                      value={h.value}
                      onChange={e => updateHeader(i, 'value', e.target.value)}
                      className="block w-full rounded-md border-slate-300 py-1.5 px-3 text-sm"
                    />
                    <button onClick={() => removeHeader(i)} className="text-slate-400 hover:text-red-500 px-2">
                      &times;
                    </button>
                  </div>
                ))}
                {headers.length === 0 && <p className="text-xs text-slate-500 italic">No custom headers</p>}
              </div>
            </div>

            {method !== 'GET' && method !== 'HEAD' && (
              <div>
                <h3 className="text-sm font-medium text-slate-900 mb-2">Request Body (JSON)</h3>
                <textarea 
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  className="block w-full h-40 rounded-lg border-slate-300 py-2 px-3 text-sm font-mono focus:border-cidco-500 focus:outline-none focus:ring-1 focus:ring-cidco-500"
                  placeholder="{&#10;  &#34;key&#34;: &#34;value&#34;&#10;}"
                />
              </div>
            )}
          </div>

          <div className="border-t lg:border-t-0 lg:border-l border-slate-200 lg:pl-6 pt-4 lg:pt-0 flex flex-col h-full">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-900">Response</h3>
              {response && (
                <div className="flex gap-3 text-xs font-medium">
                  <span className={response.status < 400 ? 'text-green-600' : 'text-red-600'}>
                    {response.status} {response.statusText}
                  </span>
                  <span className="text-slate-500">{response.time} ms</span>
                </div>
              )}
            </div>
            
            <div className="flex-1 min-h-[200px] bg-slate-900 rounded-lg overflow-hidden flex flex-col">
              {error ? (
                <div className="p-4 text-red-400 text-sm font-mono whitespace-pre-wrap">{error}</div>
              ) : response ? (
                <textarea 
                  readOnly 
                  className="flex-1 w-full bg-transparent text-emerald-400 p-4 text-sm font-mono outline-none resize-none"
                  value={typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data}
                />
              ) : (
                <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">
                  Response will appear here
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
