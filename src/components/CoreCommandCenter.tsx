import React, { useEffect, useState } from 'react';
import { supabase as supabaseRaw } from '../supabaseClient';
import { toast } from 'sonner';
import {
  Shield, 
  UserCheck, 
  Calendar, 
  Clock, 
  RotateCw, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle, 
  AlertTriangle,
  Users,
  X,
  BadgeDollarSign
} from 'lucide-react';

const supabase = supabaseRaw as any;

export default function CoreCommandCenter() {
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, trial: 0, expired: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchCoreData = async () => {
    try {
      setLoading(true);
      console.log("[CoreCommandCenter] Running high-fidelity authentication profiles and subscriptions fetch...");
      
      let authUsers: any[] = [];
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_auth_users');
        if (!rpcErr && data) {
          authUsers = data;
          console.log("[CoreCommandCenter] RPC get_auth_users loaded successfully:", authUsers.length, "users");
        } else {
          console.warn("[CoreCommandCenter] RPC get_auth_users error:", rpcErr);
        }
      } catch (rpcEx) {
        console.warn("[CoreCommandCenter] Exception calling get_auth_users rpc:", rpcEx);
      }

      // Fetch profiles
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*');

      if (pErr) {
        console.error("[CoreCommandCenter] Profiles select error:", pErr);
      }

      // Fetch subscriptions
      const { data: subs, error: sErr } = await supabase
        .from('user_subscriptions')
        .select('*');

      if (sErr) console.warn("[CoreCommandCenter] Subscriptions warn:", sErr);

      const profilesList = profiles || [];
      const subsList = subs || [];
      const joinedUsers: any[] = [];

      if (authUsers && authUsers.length > 0) {
        authUsers.forEach((au: any) => {
          const profile = profilesList.find((p: any) => p.id === au.id);
          const sub = subsList.find((s: any) => s.user_id === au.id);
          const statusVal = profile?.subscription_status || sub?.subscription_status || sub?.status || 'trial';
          
          joinedUsers.push({
            id: au.id,
            full_name: au.raw_user_meta_data?.full_name || au.raw_user_meta_data?.user_name || profile?.user_name || profile?.business_name || 'عميل مستودعي جديد',
            email: au.email || profile?.email || `user_${au.id.slice(0, 4)}@gmail.com`,
            subscription_status: profile?.role === 'super_admin' ? 'active' : statusVal,
            role: profile?.role || 'user',
            expiry_date: sub?.expiry_date || null,
            created_at: au.created_at || profile?.updated_at || new Date().toISOString()
          });
        });

        // Add any profiles that aren't in auth.users (just in case)
        profilesList.forEach((p: any) => {
          if (!joinedUsers.some(u => u.id === p.id)) {
            const sub = subsList.find((s: any) => s.user_id === p.id);
            const statusVal = p.subscription_status || sub?.subscription_status || sub?.status || 'trial';
            joinedUsers.push({
              id: p.id,
              full_name: p.user_name || p.display_name || 'عميل مستودعي',
              email: p.email || `user_${p.id.slice(0, 4)}@gmail.com`,
              subscription_status: p.role === 'super_admin' ? 'active' : statusVal,
              role: p.role || 'user',
              expiry_date: sub?.expiry_date || null,
              created_at: p.updated_at || new Date().toISOString()
            });
          }
        });
      } else {
        // Fallback to profiles alone
        profilesList.forEach((p: any) => {
          const sub = subsList.find((s: any) => s.user_id === p.id);
          const statusVal = p.subscription_status || sub?.subscription_status || sub?.status || 'trial';
          joinedUsers.push({
            id: p.id,
            full_name: p.user_name || p.display_name || 'عميل مستودعي',
            email: p.email || `user_${p.id.slice(0, 4)}@gmail.com`,
            subscription_status: p.role === 'super_admin' ? 'active' : statusVal,
            role: p.role || 'user',
            expiry_date: sub?.expiry_date || null,
            created_at: p.updated_at || new Date().toISOString()
          });
        });
      }

      // Sort by created_at descending
      joinedUsers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setUsers(joinedUsers);
      
      // Calculate dashboard metrics
      const totalCount = joinedUsers.length;
      const activeCount = joinedUsers.filter(u => u.subscription_status === 'active').length;
      const trialCount = joinedUsers.filter(u => u.subscription_status === 'trial').length;
      const expiredCount = joinedUsers.filter(u => u.subscription_status === 'expired').length;
      
      setStats({
        total: totalCount,
        active: activeCount,
        trial: trialCount,
        expired: expiredCount,
        revenue: activeCount * 100
      });

    } catch (err: any) {
      console.error("System Error in Command Link:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoreData();
  }, []);

  // Allow closing the expanded user drawer via Escape key or a global event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedUserId(null);
      }
    };

    const onCloseEvent = () => setExpandedUserId(null);

    window.addEventListener('keydown', onKey);
    window.addEventListener('close-all-overlays', onCloseEvent as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('close-all-overlays', onCloseEvent as EventListener);
    };
  }, []);

  const recalculateStats = (currUsers: any[]) => {
    const totalCount = currUsers.length;
    const activeCount = currUsers.filter(u => u.subscription_status === 'active').length;
    const trialCount = currUsers.filter(u => u.subscription_status === 'trial').length;
    const expiredCount = currUsers.filter(u => u.subscription_status === 'expired').length;
    
    setStats({
      total: totalCount,
      active: activeCount,
      trial: trialCount,
      expired: expiredCount,
      revenue: activeCount * 100
    });
  };

  const updateStatus = async (userId: string, targetStatus: string) => {
    try {
      setActionLoading(userId);
      console.log(`[CoreCommandCenter] Updating subscription status for ${userId} to ${targetStatus}`);
      
      const { error: subErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: targetStatus,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (subErr) throw subErr;

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ subscription_status: targetStatus })
        .eq('id', userId);

      if (profErr) throw profErr;

      const updated = users.map(u => u.id === userId ? { ...u, subscription_status: targetStatus } : u);
      setUsers(updated);
      recalculateStats(updated);
      toast.success('تم تحديث رخصة المشترك بنجاح في المنظومة العلوية! 📡');
    } catch (err: any) {
      console.error(err);
      toast.error(`تعذر شحن الترخيص: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  };

  const updateDays = async (userId: string, daysToAdd: number) => {
    try {
      setActionLoading(userId);
      const user = users.find(u => u.id === userId);
      if (!user) return;

      let baseDate = new Date();
      if (user.expiry_date) {
        const parsed = new Date(user.expiry_date);
        if (parsed.getTime() > Date.now()) {
          baseDate = parsed;
        }
      }

      baseDate.setDate(baseDate.getDate() + daysToAdd);
      const targetExpiryStr = baseDate.toISOString();

      const { error: dateErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: user.subscription_status,
          expiry_date: targetExpiryStr,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (dateErr) throw dateErr;

      const updated = users.map(u => u.id === userId ? { ...u, expiry_date: targetExpiryStr } : u);
      setUsers(updated);
      recalculateStats(updated);
      toast.success(`تم تمديد الترخيص بـ ${daysToAdd} يوماً بنجاح فرعي! 📅`);
    } catch (err: any) {
      console.error(err);
      toast.error('فشل إرسال حزمة التاريخ الهوائية');
    } finally {
      setActionLoading(null);
    }
  };

  const setExactDate = async (userId: string, dateVal: string) => {
    if (!dateVal) return;
    try {
      setActionLoading(userId);
      const targetExpiryStr = new Date(dateVal).toISOString();
      const user = users.find(u => u.id === userId);
      if (!user) return;

      const { error: dateErr } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_status: user.subscription_status,
          expiry_date: targetExpiryStr,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (dateErr) throw dateErr;

      const updated = users.map(u => u.id === userId ? { ...u, expiry_date: targetExpiryStr } : u);
      setUsers(updated);
      recalculateStats(updated);
      toast.success('تم ضبط خط النهاية للترخيص بنجاح! ⏱️');
    } catch (err: any) {
      console.error(err);
      toast.error('فشل تعديل قطاع الوقت المخصص');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleRole = async (userId: string, currentRole: string) => {
    try {
      setActionLoading(userId);
      const targetRole = currentRole === 'super_admin' ? 'user' : 'super_admin';
      
      const { error: roleErr } = await supabase
        .from('profiles')
        .update({ role: targetRole })
        .eq('id', userId);

      if (roleErr) throw roleErr;

      const updated = users.map(u => u.id === userId ? { ...u, role: targetRole } : u);
      setUsers(updated);
      recalculateStats(updated);
      toast.success(`تم تغيير فئة حساب المسؤول تم بنجاح لـ: ${targetRole === 'super_admin' ? 'مطور خارق' : 'مستودع عادي'}`);
    } catch (err: any) {
      console.error(err);
      toast.error('فشل ترقية الصلاحية');
    } finally {
      setActionLoading(null);
    }
  };

  // Filter subscribers based on search constraints
  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || u.subscription_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={styles.spaceBackground} id="core-command-center">
      {/* هيدر غرفة التحكم - الماتريكس العلوية */}
      <header style={styles.commandHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={styles.radarPing} />
          <div>
            <h1 style={styles.cyberTitle}>لوحة التحكم والمشتركين</h1>
            <p style={styles.cyberSubtitle}>نظام المراقبة والتحكم الشامل لتطبيق مستودعي البث الحي</p>
          </div>
        </div>
        <button onClick={fetchCoreData} style={styles.pulseButton} disabled={loading}>
          <RotateCw size={16} className={loading ? 'animate-spin' : ''} />
          تحديث رادار البيانات 🛰️
        </button>
      </header>

      {/* العدادات والمؤشرات الطافية - Telemetry Metrics */}
      <section style={styles.matrixGrid}>
        <div style={styles.cyberCard}>
          <span style={styles.cardLabel}>👥 إجمالي المشتركين الرادار</span>
          <div style={{ ...styles.cardValue, color: '#38bdf8' }}>{stats.total}</div>
        </div>
        <div style={styles.cyberCard}>
          <span style={styles.cardLabel}>🟢 المشتركين النشطين (مدفوع)</span>
          <div style={{ ...styles.cardValue, color: '#4ade80' }}>{stats.active}</div>
        </div>
        <div style={styles.cyberCard}>
          <span style={styles.cardLabel}>🟡 الحسابات التجريبية الحالية</span>
          <div style={{ ...styles.cardValue, color: '#f59e0b' }}>{stats.trial}</div>
        </div>
        <div style={styles.cyberCard}>
          <span style={styles.cardLabel}>🔴 الاشتراكات المنتهية</span>
          <div style={{ ...styles.cardValue, color: '#ef4444' }}>{stats.expired}</div>
        </div>
      </section>

      {/* شريط البحث والفرز الفضائي */}
      <div style={styles.filterBar}>
        <input 
          type="text" 
          placeholder="ابحث بالاسم، الإيميل، أو المعرف الفريد للمشترك..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.inputSearch}
        />
        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.selectFilter}
        >
          <option value="all">جميع الحالات</option>
          <option value="active">🟢 مشترك نشط / مدفوع</option>
          <option value="trial">🟡 فترة تجريبية</option>
          <option value="expired">🔴 منتهي الترخيص</option>
        </select>
      </div>

      {/* شاشة الرصد والمراقبة الحية */}
      <main style={styles.radarSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={styles.sectionTitle}>🛰️ رادار رصد والتحكم بالمشتركين</h2>
          <span style={styles.telemetryBadge}>
            رصد حي: {filteredUsers.length} من {users.length} مشتركين
          </span>
        </div>
        
        {loading ? (
          <div style={styles.loadingText}>جاري مسح القطاعات وتحميل البيانات الفضائية...</div>
        ) : filteredUsers.length === 0 ? (
          <div style={styles.loadingText}>لا يوجد مشتركين يطابقون خيارات البحث الحالية في الرادار.</div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.cyberTable}>
              <thead>
                <tr>
                  <th style={styles.th}>المعرف الفريد</th>
                  <th style={styles.th}>المستودع / المنشأة</th>
                  <th style={styles.th}>الإيميل</th>
                  <th style={styles.th}>مستوى التصريح</th>
                  <th style={styles.th}>وضعية الترخيص</th>
                  <th style={styles.th}>تاريخ الانتهاء</th>
                  <th style={styles.th}>نبض التحكم</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isExpanded = expandedUserId === user.id;
                  const isUserActionLoading = actionLoading === user.id;

                  return (
                    <React.Fragment key={user.id}>
                      <tr 
                        style={{ 
                          ...styles.trHover, 
                          backgroundColor: isExpanded ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                          borderRight: isExpanded ? '4px solid #38bdf8' : 'none'
                        }}
                      >
                        <td style={{ ...styles.td, color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>
                          {user.id.substring(0, 8)}...
                        </td>
                        <td style={{ ...styles.td, fontWeight: 'bold', color: '#f1f5f9' }}>
                          {user.full_name}
                        </td>
                        <td style={{ ...styles.td, color: '#e2e8f0' }}>{user.email}</td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.statusBadge,
                            backgroundColor: user.role === 'super_admin' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(148, 163, 184, 0.1)',
                            color: user.role === 'super_admin' ? '#c084fc' : '#94a3b8',
                            border: user.role === 'super_admin' ? '1px solid #a855f7' : '1px solid #475569'
                          }}>
                            {user.role === 'super_admin' ? '👑 مسؤول خارق' : '🏢 مستودع تجاري'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.statusBadge,
                            backgroundColor: user.subscription_status === 'active' 
                              ? 'rgba(34, 197, 94, 0.15)' 
                              : user.subscription_status === 'trial' 
                                ? 'rgba(245, 158, 11, 0.15)' 
                                : 'rgba(239, 68, 68, 0.15)',
                            color: user.subscription_status === 'active' 
                              ? '#4ade80' 
                              : user.subscription_status === 'trial' 
                                ? '#fbbf24' 
                                : '#f87171',
                            border: user.subscription_status === 'active' 
                              ? '1px solid #22c55e' 
                              : user.subscription_status === 'trial' 
                                ? '1px solid #f59e0b' 
                                : '1px solid #ef4444'
                          }}>
                            {user.subscription_status === 'active' 
                              ? '🟢 نشط / مدفوع' 
                              : user.subscription_status === 'trial' 
                                ? '🟡 تجريبي مجاني' 
                                : '🔴 منتهي الترخيص'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {user.expiry_date ? (
                            <span style={{ color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                              <Clock size={13} style={{ color: '#38bdf8' }} />
                              {new Date(user.expiry_date).toLocaleDateString('ar-EG')}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '12px' }}>غير محدد</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                            style={{
                              ...styles.controlBtn,
                              backgroundColor: isExpanded ? '#38bdf8' : 'rgba(56, 189, 248, 0.1)',
                              color: isExpanded ? '#060814' : '#38bdf8'
                            }}
                          >
                            <span>تحكم مباشر ⚙️</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                      </tr>

                      {/* لوحة تفاصيل الإدارة الموسعة الفرعية - Interactive Command Console for individual User */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={styles.drawerColSpan}>
                            <div style={styles.expandedLayout}>
                              <div style={styles.drawerSectionHeader}>
                                <Sparkles size={16} style={{ color: '#38bdf8' }} />
                                <span>لوحة التعديل والتحكم والنبض السحابي للمشترك: {user.full_name}</span>
                              </div>

                                <button
                                  onClick={() => setExpandedUserId(null)}
                                  aria-label="Close user drawer"
                                  style={{
                                    position: 'absolute',
                                    top: 12,
                                    right: 12,
                                    zIndex: 20,
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <X size={18} />
                                </button>

                              <div style={styles.controlGrid}>
                                {/* الحالة والترخيص */}
                                <div style={styles.gridColumn}>
                                  <label style={styles.formLabel}>تعديل رخصة وسريان عمل المستودع</label>
                                  <div style={styles.btnGroup}>
                                    <button 
                                      onClick={() => updateStatus(user.id, 'active')}
                                      style={{
                                        ...styles.actionToggleBtn,
                                        borderColor: user.subscription_status === 'active' ? '#4ade80' : 'rgba(255,255,255,0.05)',
                                        backgroundColor: user.subscription_status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                                        color: user.subscription_status === 'active' ? '#4ade80' : '#94a3b8'
                                      }}
                                      disabled={isUserActionLoading}
                                    >
                                      🟢 تفعيل فوري (مدفوع)
                                    </button>
                                    <button 
                                      onClick={() => updateStatus(user.id, 'trial')}
                                      style={{
                                        ...styles.actionToggleBtn,
                                        borderColor: user.subscription_status === 'trial' ? '#f59e0b' : 'rgba(255,255,255,0.05)',
                                        backgroundColor: user.subscription_status === 'trial' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                                        color: user.subscription_status === 'trial' ? '#f59e0b' : '#94a3b8'
                                      }}
                                      disabled={isUserActionLoading}
                                    >
                                      🟡 تحويل لتجريبي
                                    </button>
                                    <button 
                                      onClick={() => updateStatus(user.id, 'expired')}
                                      style={{
                                        ...styles.actionToggleBtn,
                                        borderColor: user.subscription_status === 'expired' ? '#ef4444' : 'rgba(255,255,255,0.05)',
                                        backgroundColor: user.subscription_status === 'expired' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                                        color: user.subscription_status === 'expired' ? '#ef4444' : '#94a3b8'
                                      }}
                                      disabled={isUserActionLoading}
                                    >
                                      🔴 إنهاء الترخيص (تعطيل)
                                    </button>
                                  </div>
                                </div>

                                {/* أوامر الزمن والهندسة الزمنية للنظام */}
                                <div style={styles.gridColumn}>
                                  <label style={styles.formLabel}>تمديد الزمن والشحن السريع</label>
                                  <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                      onClick={() => updateDays(user.id, 30)}
                                      style={styles.timeQuickBtn}
                                      disabled={isUserActionLoading}
                                    >
                                      ➕ تمديد 30 يوم 📅
                                    </button>
                                    <button
                                      onClick={() => updateDays(user.id, 365)}
                                      style={styles.timeQuickBtnAnnual}
                                      disabled={isUserActionLoading}
                                    >
                                      🚀 شحن سنة كاملة (365 يوم)
                                    </button>
                                  </div>

                                  <div style={{ marginTop: '12px' }}>
                                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                      أو تحديد تاريخ انتهاء ترخيص مخصص يدويًا:
                                    </span>
                                    <input 
                                      type="date"
                                      defaultValue={user.expiry_date ? new Date(user.expiry_date).toISOString().split('T')[0] : ''}
                                      onChange={(e) => setExactDate(user.id, e.target.value)}
                                      style={styles.customDatePicker}
                                      disabled={isUserActionLoading}
                                    />
                                  </div>
                                </div>

                                {/* الصلاحيات والتوزيع الحاكم */}
                                <div style={styles.gridColumn}>
                                  <label style={styles.formLabel}>تعديل الصلاحيات الأمنية للحساب</label>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <button
                                      onClick={() => toggleRole(user.id, user.role)}
                                      style={{
                                        ...styles.roleToggleButton,
                                        backgroundColor: user.role === 'super_admin' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                                        borderColor: user.role === 'super_admin' ? '#a855f7' : '#475569',
                                        color: user.role === 'super_admin' ? '#c084fc' : '#94a3b8'
                                      }}
                                      disabled={isUserActionLoading}
                                    >
                                      {user.role === 'super_admin' ? '👑 تخفيض إلى مستودع عادي' : '🛡️ ترقية إلى مسؤول خارق'}
                                    </button>

                                    <div style={styles.securityHint}>
                                      ⚠️ تنبيه أمني: تعيين الحساب كـ "مسؤول خارق" يمنحه سلطة كاملة لقراءة ومراقبة اشتراكات المستودعات الأخرى والولوج لقاعدة البيانات الكاملة.
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {isUserActionLoading && (
                                <div style={styles.actionLoaderCover}>
                                  <RotateCw size={24} className="animate-spin text-cyan-400" />
                                  <span style={{ fontSize: '12px', color: '#38bdf8' }}>جاري بث الأوامر لقاعدة البيانات السحابية الحية...</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

// elements styling
const styles: { [key: string]: React.CSSProperties } = {
  spaceBackground: {
    backgroundColor: '#060814',
    backgroundImage: 'radial-gradient(circle at 50% 50%, #0f172a 0%, #060814 100%)',
    minHeight: '100vh',
    color: '#94a3b8',
    padding: '40px',
    fontFamily: 'system-ui, sans-serif',
    direction: 'rtl',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
  },
  commandHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
    paddingBottom: '20px',
    marginBottom: '40px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  radarPing: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: '#38bdf8',
    boxShadow: '0 0 12px #38bdf8, 0 0 24px #38bdf8',
    animation: 'pulse 1.5s infinite alternate'
  },
  cyberTitle: {
    color: '#f8fafc',
    fontSize: '28px',
    fontWeight: '900',
    textShadow: '0 0 20px rgba(56, 189, 248, 0.4)'
  },
  cyberSubtitle: {
    color: '#38bdf8',
    fontSize: '14px',
    marginTop: '4px'
  },
  pulseButton: {
    background: 'rgba(56, 189, 248, 0.1)',
    border: '1px solid #38bdf8',
    color: '#38bdf8',
    padding: '10px 20px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'all 0.3s ease',
    boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  matrixGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '24px',
    marginBottom: '30px'
  },
  cyberCard: {
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
    position: 'relative',
    overflow: 'hidden'
  },
  cardLabel: {
    fontSize: '13px',
    color: '#94a3b8',
    fontWeight: '600'
  },
  cardValue: {
    fontSize: '36px',
    fontWeight: 'bold',
    marginTop: '8px',
    textShadow: '0 0 10px rgba(255,255,255,0.1)'
  },
  filterBar: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  inputSearch: {
    flex: 1,
    minWidth: '280px',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    borderRadius: '12px',
    padding: '12px 18px',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)'
  },
  selectFilter: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    borderRadius: '12px',
    padding: '12px 18px',
    color: '#3d94ff',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer'
  },
  radarSection: {
    background: 'rgba(15, 23, 42, 0.4)',
    backdropFilter: 'blur(25px)',
    border: '1px solid rgba(56, 189, 248, 0.1)',
    borderRadius: '20px',
    padding: '30px',
    boxShadow: '0 30px 60px rgba(0,0,0,0.6)'
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: '20px',
    margin: 0
  },
  telemetryBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    color: '#38bdf8',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    border: '1px solid rgba(56, 189, 248, 0.2)'
  },
  tableContainer: {
    overflowX: 'auto'
  },
  cyberTable: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'right'
  },
  th: {
    borderBottom: '2px solid rgba(255,255,255,0.05)',
    padding: '16px',
    color: '#38bdf8',
    fontSize: '14px',
    fontWeight: '600'
  },
  td: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    color: '#cbd5e1',
    fontSize: '14px'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 'bold',
    display: 'inline-block',
    boxShadow: '0 0 10px rgba(0,0,0,0.2)'
  },
  controlBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid rgba(56, 189, 248, 0.2)',
    padding: '6px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'all 0.2s ease'
  },
  drawerColSpan: {
    padding: '20px',
    backgroundColor: 'rgba(5, 7, 20, 0.7)',
    borderBottom: '1px solid rgba(56, 189, 248, 0.3)'
  },
  expandedLayout: {
    border: '1px solid rgba(56, 189, 248, 0.25)',
    borderRadius: '14px',
    padding: '24px',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
    position: 'relative'
  },
  drawerSectionHeader: {
    color: '#38bdf8',
    fontWeight: 'bold',
    fontSize: '14px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    paddingBottom: '10px'
  },
  controlGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '24px'
  },
  gridColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  formLabel: {
    color: '#f8fafc',
    fontSize: '13px',
    fontWeight: 'bold'
  },
  btnGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  actionToggleBtn: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'right',
    transition: 'all 0.2s ease'
  },
  timeQuickBtn: {
    flex: 1,
    background: 'rgba(56, 189, 248, 0.08)',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    color: '#38bdf8',
    padding: '10px 14px',
    borderRadius: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s ease'
  },
  timeQuickBtnAnnual: {
    flex: 1.2,
    background: 'rgba(16, 185, 129, 0.08)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    color: '#34d399',
    padding: '10px 14px',
    borderRadius: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s ease'
  },
  customDatePicker: {
    width: '100%',
    backgroundColor: 'rgba(5, 7, 20, 0.8)',
    border: '1px solid rgba(56, 189, 248, 0.2)',
    borderRadius: '10px',
    padding: '10px 14px',
    color: '#f8fafc',
    outline: 'none',
    fontSize: '13px'
  },
  roleToggleButton: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.2s ease'
  },
  securityHint: {
    fontSize: '11px',
    color: '#64748b',
    lineHeight: '1.5',
    backgroundColor: 'rgba(239, 68, 68, 0.04)',
    border: '1px solid rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
    padding: '10px'
  },
  actionLoaderCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 20, 0.85)',
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    backdropFilter: 'blur(4px)',
    zIndex: 10
  },
  loadingText: {
    textAlign: 'center',
    padding: '40px',
    color: '#38bdf8'
  },
  trHover: {
    transition: 'all 0.2s'
  }
};
