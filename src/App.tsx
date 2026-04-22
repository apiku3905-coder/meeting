/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  LogOut, 
  Settings, 
  Trash2, 
  Edit,
  Copy,
  Bell
} from 'lucide-react';
import { format } from 'date-fns';

// Sync meetings and settings to the local server
async function syncToServer(userId: string, lineToken: string, lineUserId: string, dailyReminderTime: string, meetings: any[]) {
  try {
    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, lineToken, lineUserId, dailyReminderTime, meetings })
    });
  } catch (error) {
    console.error("Failed to sync to server:", error);
  }
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals state
  const [showSettings, setShowSettings] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  
  // Settings state
  const [lineToken, setLineToken] = useState('');
  const [lineUserId, setLineUserId] = useState('');
  const [dailyReminderTime, setDailyReminderTime] = useState('08:00');
  
  // Form State
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm'),
    units: '',
    outline: '',
    preparation: '',
    remindMinutes: 10
  });

  // Check local storage for existing session
  useEffect(() => {
    const savedUser = localStorage.getItem('localUser');
    if (savedUser) {
      setUser(savedUser);
    } else {
      setLoading(false);
    }
  }, []);

  // Fetch data when user logs in
  useEffect(() => {
    if (!user) return;
    
    let isMounted = true;
    setLoading(true);
    
    fetch(`/api/data/${user}`)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        setLineToken(data.lineToken || '');
        setLineUserId(data.lineUserId || '');
        setDailyReminderTime(data.dailyReminderTime || '08:00');
        setMeetings(data.meetings || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load user data:", err);
        setLoading(false);
      });
      
    return () => { isMounted = false; };
  }, [user]);

  // Sync to server every time these dependencies change
  useEffect(() => {
    if (user && !loading) {
       syncToServer(user, lineToken, lineUserId, dailyReminderTime, meetings);
    }
  }, [user, lineToken, lineUserId, dailyReminderTime, meetings, loading]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameInput.trim()) {
      setUser(usernameInput.trim());
      localStorage.setItem('localUser', usernameInput.trim());
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('localUser');
    setMeetings([]);
    setLineToken('');
    setLineUserId('');
    setDailyReminderTime('08:00');
  };

  const saveSettings = () => {
    alert("設定已儲存！");
    setShowSettings(false);
    // syncToServer will be triggered automatically via useEffect
  };

  const testLineNotification = async () => {
     try {
       await fetch('/api/test-line', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ lineToken, lineUserId })
       });
       alert("已發送測試通知，請檢查您的 LINE。");
     } catch(e) {
       alert("發送測試通知失敗。");
     }
  };

  const handleMeetingSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!formData.units || !formData.outline) {
      return alert("與會單位和大綱為必填");
    }

    try {
      if (editingMeetingId) {
        setMeetings(prev => prev.map(m => m.id === editingMeetingId ? {
          ...m,
          ...formData,
          updatedAt: new Date().toISOString()
        } : m));
      } else {
        const id = Date.now().toString();
        setMeetings(prev => [...prev, {
          ...formData,
          id,
          userId: user,
          isCompleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]);
      }
      setShowMeetingModal(false);
      setEditingMeetingId(null);
      setFormData({
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm'),
        units: '',
        outline: '',
        preparation: '',
        remindMinutes: 10
      });
    } catch (err: any) {
      console.error(err);
      alert("儲存失敗: " + err.message);
    }
  };

  const toggleComplete = (m: any) => {
    setMeetings(prev => prev.map(item => item.id === m.id ? {
      ...item,
      isCompleted: !item.isCompleted,
      updatedAt: new Date().toISOString()
    } : item));
  };

  const requestDeleteMeeting = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '刪除會議',
      message: '確定要刪除這個會議嗎？這個動作無法復原。',
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        setMeetings(prev => prev.filter(item => item.id !== id));
      }
    });
  };

  const requestClearAllCompleted = () => {
    if (completedMeetings.length === 0) return;
    setConfirmDialog({
      isOpen: true,
      title: '清除所有紀錄',
      message: '確定要清除所有已完成的會議紀錄嗎？這個動作無法復原。',
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        setMeetings(prev => prev.filter(item => !item.isCompleted));
      }
    });
  };

  const openReschedule = (m: any) => {
    setFormData({
      date: format(new Date(), 'yyyy-MM-dd'),
      time: format(new Date(), 'HH:mm'),
      units: m.units,
      outline: m.outline,
      preparation: m.preparation,
      remindMinutes: m.remindMinutes || 10
    });
    setEditingMeetingId(null);
    setShowMeetingModal(true);
  };

  const openEdit = (m: any) => {
    setFormData({
      date: m.date,
      time: m.time,
      units: m.units,
      outline: m.outline,
      preparation: m.preparation,
      remindMinutes: m.remindMinutes || 10
    });
    setEditingMeetingId(m.id);
    setShowMeetingModal(true);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FFF0E5] flex flex-col items-center justify-center p-4 font-sans selection:bg-black selection:text-white">
        <div className="bg-white p-8 border-4 border-black shadow-[8px_8px_0px_#000] max-w-md w-full text-center">
          <Calendar className="w-16 h-16 text-black mx-auto mb-6 drop-shadow-[2px_2px_0px_#FFD700]" strokeWidth={2.5} />
          <h1 className="text-3xl font-bold tracking-tight text-black mb-2 uppercase">制宜電測<br/>會議中心</h1>
          <p className="text-black font-semibold mb-8 border-t-2 border-black pt-4 mt-4">管理您的會議排程，並在每天早上及會議前自訂時間收到 LINE 提醒。</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input 
              type="text" 
              required
              placeholder="請輸入使用者名稱" 
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value)}
              className="w-full border-4 border-black bg-[#f0f0f0] px-4 py-3 text-lg font-bold text-center focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000]"
            />
            <button 
              type="submit"
              className="w-full bg-[#A3FF99] hover:bg-[#8AF080] text-black border-4 border-black font-bold uppercase tracking-widest py-4 px-4 shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] transition-all flex items-center justify-center gap-2"
            >
              進入系統
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Sorting: Pending first (chronological), Completed last (reverse chronological)
  const pendingMeetings = meetings.filter(m => !m.isCompleted).sort((a,b) => {
    const timeA = new Date(`${a.date}T${a.time}`).getTime();
    const timeB = new Date(`${b.date}T${b.time}`).getTime();
    return timeA - timeB;
  });
  
  const completedMeetings = meetings.filter(m => m.isCompleted).sort((a,b) => {
    const timeA = new Date(`${a.date}T${a.time}`).getTime();
    const timeB = new Date(`${b.date}T${b.time}`).getTime();
    return timeB - timeA;
  });

  const nextMeeting = pendingMeetings.length > 0 ? pendingMeetings[0] : null;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayCount = pendingMeetings.filter(m => m.date === todayStr).length;

  return (
    <div className="bg-[#FFF0E5] md:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiMwMDAiIG9wYWNpdHk9IjAuMSIvPjwvc3ZnPg==')] min-h-screen p-4 sm:p-6 font-sans text-black flex flex-col selection:bg-black selection:text-white pb-32">
      {/* Header Navigation */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4 max-w-7xl mx-auto w-full bg-white border-4 border-black shadow-[8px_8px_0px_#000] p-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#FFD700] border-4 border-black shadow-[4px_4px_0px_#000] flex items-center justify-center -rotate-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex flex-col mb-1">
            <div className="flex flex-col sm:flex-row justify-center sm:items-center gap-2 mb-1 pl-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-black uppercase m-0 leading-none">制宜電測會議中心</h1>
                <button 
                  onClick={() => setShowSettings(true)}
                  className="w-8 h-8 flex items-center justify-center bg-[#CFA3FF] border-2 border-black shadow-[2px_2px_0px_#000] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_#000] transition-all relative group cursor-pointer" 
                  title="自動化與提醒設定"
                >
                  <Bell className="w-4 h-4 text-black group-hover:rotate-12 transition-transform" strokeWidth={2.5} />
                  {lineToken && lineUserId ? (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#A3FF99] border-2 border-black rounded-full" title="已啟用自動化"></span>
                  ) : (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#FF4444] border-2 border-black rounded-full animate-pulse" title="未啟用自動化"></span>
                  )}
                </button>
              </div>
              {/* Minimal Stats Block next to Bell */}
              <div className="flex items-stretch h-8 border-2 border-black shadow-[2px_2px_0px_#000] sm:ml-2 mt-2 sm:mt-0">
                <div className="flex items-center justify-center px-2 bg-[#FF9999] border-r-2 border-black leading-none gap-1">
                  <span className="text-[10px] font-black uppercase">待辦</span>
                  <span className="text-sm font-black font-mono">{pendingMeetings.length}</span>
                </div>
                <div className="flex items-center justify-center px-2 bg-[#FFD700] border-r-2 border-black leading-none gap-1">
                  <span className="text-[10px] font-black uppercase">今天</span>
                  <span className="text-sm font-black font-mono">{todayCount}</span>
                </div>
                <div className="flex items-center justify-center px-2 bg-white leading-none gap-1">
                  <span className="text-[10px] font-black uppercase text-slate-500">已完成</span>
                  <span className="text-sm font-black font-mono text-slate-500">{completedMeetings.length}</span>
                </div>
              </div>
            </div>
            <div className="mt-1">
              <p className="text-xs text-black font-bold uppercase tracking-widest bg-[#A3FF99] border-2 border-black inline-block px-1">智慧提醒與排程</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 flex-wrap mt-4 sm:mt-0">
          
          <div className="flex items-center gap-2 hidden sm:flex border-l-4 border-black pl-5 ml-2 h-8">
            <div className="w-8 h-8 bg-[#f0f0f0] border-2 border-black flex items-center justify-center font-bold">
              {user.charAt(0).toUpperCase()}
            </div>
            <span className="font-bold hidden md:inline-block">{user}</span>
          </div>
          <button onClick={handleLogout} className="text-black hover:bg-black hover:text-[#FFF0E5] border-2 border-transparent hover:border-black p-1 transition-colors" title="登出">
            <LogOut className="w-6 h-6" strokeWidth={2.5} />
          </button>

          <button onClick={() => {
              setEditingMeetingId(null);
              setFormData({date: format(new Date(), 'yyyy-MM-dd'), time: format(new Date(), 'HH:mm'), units: '', outline: '', preparation: '', remindMinutes: 10});
              setShowMeetingModal(true);
            }} 
            className="bg-[#99CCFF] text-black border-4 border-black px-4 py-2 font-bold uppercase tracking-wider hover:bg-[#80BFFF] shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] transition-all ml-2">
            + 新增會議
          </button>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-6 lg:grid-flow-row-dense gap-4 h-full min-h-[600px]">

          {/* Upcoming Schedule List */}
          <div className="lg:col-span-8 lg:row-span-6 bg-white border-4 border-black p-6 shadow-[8px_8px_0px_#000] flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b-4 border-black pb-2">
              <h3 className="font-black text-2xl uppercase tracking-widest text-[#FF4444]">已預約的會議</h3>
            </div>
            <div className="space-y-4 overflow-y-auto flex-grow pr-2 custom-scrollbar">
              {pendingMeetings.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xl font-bold text-slate-400 italic">目前沒有任何已預約的會議。</p>
                </div>
              ) : (
                  pendingMeetings.map(m => {
                    const mDate = new Date(m.date);
                    const mon = format(mDate, 'M') + '月';
                    const day = format(mDate, 'dd');
                    return (
                      <div key={m.id} className="flex items-stretch bg-white border-4 border-black shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] transition-all group p-0 min-h-[120px]">
                        <div className="w-[5.5rem] bg-[#A3FF99] border-r-4 border-black flex flex-col items-center pt-[10px] pb-4 flex-shrink-0 text-black">
                          <span className="text-[20px] font-bold uppercase mt-0 -mb-[39px] z-10">{mon}</span>
                          <span className="text-[35px] font-black font-mono mt-[29px] mb-0">{day}</span>
                          <span className="text-[20px] leading-[30px] font-black font-mono border-t-2 border-black w-full text-center pt-[10px] -mb-[9px] mt-auto">{m.time}</span>
                        </div>
                        <div className="flex flex-grow items-center p-3 gap-4 min-w-0">
                          <div className="flex-grow min-w-0 flex flex-col gap-3 justify-center">
                            <div className="flex items-start gap-2">
                              <span className="bg-black text-white px-2 py-1 inline-block uppercase tracking-widest text-[18px] leading-[18px] flex-shrink-0">與會單位/人員</span>
                              <p className="text-[18px] leading-[28px] font-black text-black truncate uppercase -mt-[2px]">{m.units}</p>
                            </div>
                            {m.outline && (
                              <div className="flex items-start gap-2">
                                <span className="bg-black text-white px-2 py-1 inline-block uppercase tracking-widest text-[18px] leading-[18px] flex-shrink-0">大綱</span>
                                <p className="text-[18px] leading-[28px] text-black font-black truncate max-w-full -mt-[2px]">{m.outline}</p>
                              </div>
                            )}
                            {m.preparation && (
                              <div className="flex items-start gap-2">
                                <span className="bg-black text-white px-2 py-1 inline-block uppercase tracking-widest text-[18px] leading-[18px] flex-shrink-0">準備資料</span>
                                <p className="text-[18px] leading-[28px] text-black font-black whitespace-pre-wrap -mt-[2px]">{m.preparation}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 flex-shrink-0 self-start sm:self-center">
                            <button onClick={() => toggleComplete(m)} className="text-sm font-bold bg-[#A3FF99] border-2 border-black text-black px-3 py-2 uppercase tracking-wider hover:bg-black hover:text-white transition-colors" title="標記完成">完成</button>
                            <button onClick={() => openEdit(m)} className="p-2 border-2 border-black bg-[#99CCFF] hover:bg-black text-black hover:text-white transition-colors"><Edit className="w-5 h-5"/></button>
                            <button onClick={() => requestDeleteMeeting(m.id)} className="p-2 border-2 border-black bg-[#FF9999] hover:bg-[#FF4444] text-black hover:text-white transition-colors"><Trash2 className="w-5 h-5"/></button>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Quick Actions Card / Completed Info */}
          <div className="lg:col-span-4 lg:row-span-6 bg-black border-4 border-black shadow-[8px_8px_0px_#000] p-6 text-white flex flex-col">
            <div className="flex items-center justify-between mb-6 flex-shrink-0 border-b-2 border-[#99CCFF] pb-4">
              <div>
                <h3 className="text-2xl font-black uppercase text-[#99CCFF]">重新預約</h3>
                <p className="text-xs font-bold mt-2">完成了會議？立即使用先前的設定一鍵預約下一次。</p>
              </div>
              <button 
                onClick={requestClearAllCompleted}
                disabled={completedMeetings.length === 0}
                className="p-2 ml-2 flex-shrink-0 border-2 border-[#FF9999] text-[#FF9999] hover:bg-[#FF9999] hover:text-black hover:shadow-[4px_4px_0px_#FF9999] hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#FF9999] disabled:hover:shadow-none disabled:hover:translate-y-0 transition-all focus:outline-none"
                title="清除所有紀錄"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-grow space-y-4 overflow-y-auto pr-2">
              {completedMeetings.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm font-bold text-slate-500 italic">尚無已完成的會議。</p>
                </div>
              ) : (
                completedMeetings.slice(0, 5).map(m => (
                  <div key={m.id} className="flex gap-2 items-stretch">
                    <button onClick={() => openReschedule(m)} className="flex-1 w-full flex items-center justify-between p-3 bg-white border-2 border-black hover:bg-[#FFD700] hover:-translate-y-1 hover:shadow-[4px_4px_0px_#99CCFF] transition-all group text-left">
                      <div className="min-w-0 pr-2">
                        <p className="text-sm font-black truncate text-black uppercase">{m.units}</p>
                        <p className="text-[10px] font-bold text-black border-t-2 border-dashed border-black pt-1 mt-1 font-mono">上次：{m.date} {m.time}</p>
                      </div>
                      <Copy className="w-6 h-6 text-black flex-shrink-0 border-2 border-transparent group-hover:border-black p-0.5 rounded-full" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={() => requestDeleteMeeting(m.id)}
                      className="p-3 border-2 border-black bg-[#FF9999] hover:bg-[#FF4444] text-black hover:text-white transition-all hover:-translate-y-1 hover:shadow-[4px_4px_0px_#000] flex-shrink-0 flex items-center justify-center"
                      title="刪除紀錄"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 mt-2 border-t-4 border-white flex-shrink-0 bg-[#A3FF99] -mx-6 -mb-6 p-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-black shadow-[2px_2px_0px_#FFF] animate-pulse"></div>
                <span className="text-xs font-black text-black uppercase tracking-widest">狀態：已與 LINE 同步</span>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Meeting Modal */}
      {showMeetingModal && (
        <div className="fixed inset-0 bg-[#FFD700]/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg border-4 border-black shadow-[12px_12px_0px_#000] flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b-4 border-black flex items-center justify-between bg-[#99CCFF]">
              <h2 className="text-2xl font-black text-black uppercase tracking-widest">{editingMeetingId ? '編輯會議' : '新增會議'}</h2>
              <button onClick={() => setShowMeetingModal(false)} className="text-black hover:bg-black hover:text-[#99CCFF] border-2 border-transparent hover:border-black p-1 transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <form onSubmit={handleMeetingSave} className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#f0f0f0]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">日期 <span className="text-[#FF4444]">*</span></label>
                  <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-mono font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000]" />
                </div>
                <div>
                  <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">時間 <span className="text-[#FF4444]">*</span></label>
                  <input required type="time" value={formData.time} onChange={e => setFormData({...formData, time: e.target.value})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-mono font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000]" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">與會單位 / 人員 <span className="text-[#FF4444]">*</span></label>
                <input required type="text" placeholder="例如：行銷團隊" value={formData.units} onChange={e => setFormData({...formData, units: e.target.value})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000]" />
              </div>

              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">大綱 <span className="text-[#FF4444]">*</span></label>
                <textarea required rows={3} placeholder="簡述大綱..." value={formData.outline} onChange={e => setFormData({...formData, outline: e.target.value})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000] resize-none"></textarea>
              </div>

              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">準備資料 (選填)</label>
                <textarea rows={2} placeholder="需要準備的連結或文件..." value={formData.preparation} onChange={e => setFormData({...formData, preparation: e.target.value})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000] resize-none"></textarea>
              </div>

              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase tracking-wider">提前提醒(分) <span className="text-[#FF4444]">*</span></label>
                <input required type="number" min="5" max="60" step="5" value={formData.remindMinutes || 10} onChange={e => setFormData({...formData, remindMinutes: parseInt(e.target.value) || 10})} className="w-full border-4 border-black bg-white px-4 py-3 text-sm font-mono font-bold focus:bg-yellow-100 outline-none transition-colors shadow-[4px_4px_0px_#000]" />
              </div>

              <div className="pt-6 flex gap-4 justify-end mt-4 border-t-4 border-dashed border-black">
                <button type="button" onClick={() => setShowMeetingModal(false)} className="px-6 py-3 border-4 border-black bg-white text-black font-black uppercase hover:bg-black hover:text-white transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm">取消</button>
                <button type="submit" className="px-6 py-3 border-4 border-black bg-[#A3FF99] text-black font-black uppercase hover:bg-[#8AF080] transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm">
                  {editingMeetingId ? '儲存變更' : '預約會議'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-[#FFD700]/70 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg border-4 border-black shadow-[12px_12px_0px_#000] flex flex-col overflow-hidden">
            <div className="p-6 border-b-4 border-black flex items-start sm:items-center justify-between bg-[#CFA3FF] gap-2 flex-col sm:flex-row">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-grow w-full">
                <h2 className="text-2xl font-black flex items-center gap-2 uppercase tracking-widest text-black whitespace-nowrap"><Settings className="w-6 h-6 stroke-[3]" /> LINE 通知設定</h2>
                <div className="flex items-center gap-2 bg-white pl-2 pr-2 border-2 border-black shadow-[2px_2px_0px_#000] w-[190px] h-[33px]">
                  <label className="text-[14px] leading-[18px] font-black whitespace-nowrap uppercase">每日提醒</label>
                  <input type="time" value={dailyReminderTime} onChange={e => setDailyReminderTime(e.target.value)} className="font-mono font-bold outline-none text-black bg-transparent text-[13px] -ml-[3px] w-[109px]" />
                </div>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-black hover:bg-black hover:text-[#CFA3FF] border-2 border-transparent hover:border-black p-1 transition-colors absolute top-6 right-6 sm:static sm:flex-shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 space-y-6 bg-[#f0f0f0] relative">
              <div className="bg-[#FF9999] border-4 border-black p-4 text-sm text-black font-bold shadow-[4px_4px_0px_#000]">
                <p>設定您的 <strong>LINE Messaging API</strong> 金鑰以啟用每日 {dailyReminderTime} 摘要和會前提醒。</p>
              </div>

              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase">Channel Access Token (存取權杖)</label>
                <input type="password" value={lineToken} onChange={e => setLineToken(e.target.value)} className="w-full border-4 border-black bg-white px-4 py-3 text-sm focus:bg-[#FFF9E6] outline-none transition-colors font-mono font-bold shadow-[4px_4px_0px_#000]" placeholder="長效存取權杖" />
              </div>
              
              <div>
                <label className="block text-sm font-black text-black mb-2 uppercase">User ID (使用者 ID)</label>
                <input type="text" value={lineUserId} onChange={e => setLineUserId(e.target.value)} className="w-full border-4 border-black bg-white px-4 py-3 text-sm focus:bg-[#FFF9E6] outline-none transition-colors font-mono font-bold shadow-[4px_4px_0px_#000]" placeholder="Uxxxxxxxxxxxxxxxxxc" />
                <p className="text-xs font-bold text-black border-l-4 border-black pl-2 mt-3 bg-white p-2 border-y-2 border-r-2 inline-block">請在 Developer Console 的 Basic settings 分頁最下方找到您的 LINE User ID (並非您的 LINE ID)。</p>
              </div>

            </div>

            <div className="p-6 border-t-4 border-black flex flex-col sm:flex-row gap-4 justify-between items-center bg-white">
              <button type="button" onClick={testLineNotification} className="w-full sm:w-auto px-5 py-3 border-4 border-black bg-[#FFF0E5] hover:bg-[#FFD700] text-sm font-black text-black uppercase transition-all shadow-[4px_4px_0px_#000]">
                發送測試通知
              </button>
              <div className="flex gap-3 w-full sm:w-auto">
                <button type="button" onClick={() => setShowSettings(false)} className="flex-1 sm:flex-none px-5 py-3 border-4 border-black bg-white text-black font-black uppercase hover:bg-black hover:text-white transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm">取消</button>
                <button type="button" onClick={saveSettings} className="flex-1 sm:flex-none px-5 py-3 border-4 border-black bg-[#99CCFF] text-black font-black uppercase hover:bg-[#80BFFF] transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm">
                  儲存設定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-[#FFD700]/70 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm border-4 border-black shadow-[12px_12px_0px_#000] flex flex-col overflow-hidden">
            <div className="p-4 border-b-4 border-black flex items-center justify-between bg-[#FF9999]">
              <h2 className="text-xl font-black text-black uppercase tracking-widest">{confirmDialog.title}</h2>
              <button onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} className="text-black hover:bg-black hover:text-[#FF9999] border-2 border-transparent hover:border-black p-1 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 bg-white">
              <p className="text-black font-bold whitespace-pre-wrap">{confirmDialog.message}</p>
            </div>
            <div className="p-4 border-t-4 border-black flex gap-3 bg-[#f0f0f0]">
              <button 
                type="button" 
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 px-4 py-3 border-4 border-black bg-white text-black font-black uppercase hover:bg-black hover:text-white transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm"
              >
                取消
              </button>
              <button 
                type="button" 
                onClick={confirmDialog.onConfirm} 
                className="flex-1 px-4 py-3 border-4 border-black bg-[#FF9999] text-black font-black uppercase hover:bg-[#FF4444] hover:text-white transition-colors shadow-[4px_4px_0px_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000] text-sm"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
