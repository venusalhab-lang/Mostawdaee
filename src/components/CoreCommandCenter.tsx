import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchAdminSubscribers, mutateAdminSubscription } from '../lib/adminSubscriptionApi';
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

export default function CoreCommandCenter() {
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, trial: 0, expired: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const applyStats = (rows: any[]) => {
    setStats({
      total: rows.length,
      active: rows.filter(u => u.subscription_status === 'active').length,
      trial: rows.filter(u => u.subscription_status === 'trial').length,
      expired: rows.filter(u => u.subscription_status === 'expired').length,
      revenue: 0,
    });
  };

  const fetchCoreData = async () => {
    try {
      setLoading(true);
      const { subscribers } = await fetchAdminSubscribers();
      const joinedUsers = (subscribers || []).map((row) => ({
        id: row.id,
        full_name: row.businessName || row.displayName || 'عميل مستودعي',
        email: row.email || 'بدون بريد',
        subscription_status: row.status,
        role: row.role || 'user',
        expiry_date: row.endsAt,
        days_remaining: row.daysRemaining,
        created_at: row.trialStart || new Date(0).toISOString(),
      }));
      setUsers(joinedUsers);
      applyStats(joinedUsers);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر قراءة المشتركين');
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

  const updateStatus = async (userId: string, targetStatus: string) => {
    try {
      setActionLoading(userId);
      const op = targetStatus === 'active' ? 'mark_paid' : targetStatus === 'trial' ? 'set_trial' : 'expire';
      await mutateAdminSubscription({ userId, op });
      await fetchCoreData();
      toast.success('تم تحديث الاشتراك');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تعديل الاشتراك');
    } finally {
      setActionLoading(null);
    }
  };

  const updateDays = async (userId: string, daysToAdd: number) => {
    try {
      setActionLoading(userId);
      await mutateAdminSubscription({ userId, op: 'extend', days: daysToAdd });
      await fetchCoreData();
      toast.success(`تم التمديد ${daysToAdd} يوماً`);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر التمديد');
    } finally {
      setActionLoading(null);
    }
  };

  const setExactDate = async (userId: string, dateVal: string) => {
    if (!dateVal) return;
    try {
      setActionLoading(userId);
      await mutateAdminSubscription({ userId, op: 'set_expiry', expiry: dateVal });
      await fetchCoreData();
      toast.success('تم ضبط تاريخ الانتهاء');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ضبط التاريخ');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleRole = async (_userId: string, _currentRole: string) => {
    toast.error('تغيير رتبة الحساب لا يتم من لوحة الاشتراك');
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
          placeholder="ابحث بالاسم، الإيميل، أو المعرف الفريد للمشترك..." aria-label="ابحث بالاسم، الإيميل، أو المعرف الفريد للمشترك..."
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
                          <span style={{ color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13px' }}>
                            <strong>{user.days_remaining ?? 0} يوماً</strong>
                            {user.expiry_date ? (
                              <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                                <Clock size={13} style={{ color: '#38bdf8' }} />
                                {new Date(user.expiry_date).toLocaleDateString('ar-EG')}
                              </span>
                            ) : null}
                          </span>
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
