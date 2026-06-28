import React from 'react';
import {
  Home, Users, BarChart3, List, Clock, Mail, Bell, LogOut, User, Film, Search,
  ClipboardList, Clipboard, Target, Shield, Dumbbell, Brain, Activity, Crosshair,
  ChevronRight, ChevronDown, ChevronLeft, X, Plus, Minus, Pencil, Trash2, Printer,
  Share2, Send, Sparkles, PlayCircle, Check, CheckCircle2, Circle, Camera,
  ShieldCheck, Link as LinkIcon, QrCode, Mic, ArrowLeft, Info, Download, Upload,
  FileText, MessageSquare, TrendingUp, TrendingDown, Calendar, MapPin, Sun, Moon,
  ChevronUp, Settings, Star, Award, Zap, Eye, Lock, RefreshCw, Filter, BookOpen,
} from 'lucide-react-native';

// Lucide-name (kebab, as referenced in the design README) -> component.
const MAP: Record<string, React.ComponentType<any>> = {
  'home': Home,
  'users': Users,
  'bar-chart-3': BarChart3, 'bar-chart': BarChart3,
  'list': List,
  'clock': Clock,
  'mail': Mail,
  'bell': Bell,
  'log-out': LogOut,
  'user': User,
  'film': Film,
  'search': Search,
  'clipboard-list': ClipboardList,
  'clipboard': Clipboard,
  'target': Target,
  'shield': Shield,
  'dumbbell': Dumbbell,
  'brain': Brain,
  'activity': Activity,
  'crosshair': Crosshair,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  'x': X,
  'plus': Plus,
  'minus': Minus,
  'pencil': Pencil, 'edit': Pencil, 'edit-3': Pencil,
  'trash-2': Trash2, 'trash': Trash2,
  'printer': Printer,
  'share-2': Share2, 'share': Share2,
  'send': Send,
  'sparkles': Sparkles,
  'play-circle': PlayCircle,
  'check': Check,
  'check-circle': CheckCircle2, 'check-circle-2': CheckCircle2,
  'circle': Circle,
  'camera': Camera,
  'shield-check': ShieldCheck,
  'link': LinkIcon,
  'qr-code': QrCode,
  'mic': Mic,
  'arrow-left': ArrowLeft,
  'info': Info,
  'download': Download,
  'upload': Upload,
  'file-text': FileText,
  'message-square': MessageSquare,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  'calendar': Calendar,
  'map-pin': MapPin,
  'sun': Sun,
  'moon': Moon,
  'settings': Settings,
  'star': Star,
  'award': Award,
  'zap': Zap,
  'eye': Eye,
  'lock': Lock,
  'refresh-cw': RefreshCw, 'refresh': RefreshCw,
  'filter': Filter,
  'book-open': BookOpen,
};

export type IconName = keyof typeof MAP | string;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
};

/** Themed Lucide icon, looked up by the design's Lucide name. */
export function Icon({ name, size = 22, color = '#000', strokeWidth = 2, fill = 'none' }: Props) {
  const Cmp = MAP[name] ?? Circle;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} fill={fill} />;
}

export default Icon;
