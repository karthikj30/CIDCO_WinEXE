import { type ApiRequestLog } from '@prisma/client';

export default function ApiLogsTable({ logs }: { logs: ApiRequestLog[] }) {
  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">API Logs</h2>
        <p className="text-slate-500 mt-1">Monitor real-time API requests made to the platform endpoints.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Method / Endpoint</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Duration</th>
                <th className="px-6 py-3 font-medium">IP Address</th>
                <th className="px-6 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium mr-2 ${
                      log.method === 'GET' ? 'bg-blue-100 text-blue-700' :
                      log.method === 'POST' ? 'bg-green-100 text-green-700' :
                      log.method === 'DELETE' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {log.method}
                    </span>
                    <span className="font-mono text-slate-700">{log.endpoint}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      log.statusCode < 400 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {log.statusCode}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                    {log.durationMs}ms
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                    {log.ip || '-'}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    No API logs found yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
