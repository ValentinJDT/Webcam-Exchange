import React, { forwardRef } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';

export interface LogEntry {
  time: string;
  type: 'info' | 'success' | 'error' | 'warning' | string;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
  showLogs: boolean;
  onToggle: () => void;
  isLandscape?: boolean;
  variant?: 'default' | 'overlay';
  onClose?: () => void;
}

const LogViewer = forwardRef<ScrollView, LogViewerProps>(
  ({ logs, showLogs, onToggle, isLandscape = false, variant = 'default', onClose }, ref) => {
    const styles = isLandscape ? landscapeStyles : defaultStyles;

    if (variant === 'overlay') {
      return (
        <>
          {showLogs && (
            <View style={[overlayStyles.container, isLandscape && overlayStyles.containerLandscape]}>
              <View style={overlayStyles.header}>
                <Text style={overlayStyles.headerText}>Logs</Text>
                <TouchableOpacity onPress={onClose || onToggle}>
                  <Ionicons name="close" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              <ScrollView ref={ref} style={[overlayStyles.scroll, isLandscape && overlayStyles.scrollLandscape]}>
                <LogList logs={logs} />
              </ScrollView>
            </View>
          )}
          <TouchableOpacity
            style={[overlayStyles.toggle, isLandscape && overlayStyles.toggleLandscape]}
            onPress={onToggle}
          >
            <Ionicons name="list-outline" size={16} color="#fff" />
          </TouchableOpacity>
        </>
      );
    }

    return (
      <>
        <TouchableOpacity style={styles.button} onPress={onToggle}>
          <Ionicons name={showLogs ? 'chevron-up' : 'chevron-down'} size={isLandscape ? 16 : 18} color="#fff" />
          <Text style={styles.buttonText}>
            {showLogs ? 'Masquer les logs' : 'Afficher les logs'}
          </Text>
        </TouchableOpacity>

        {showLogs && (
          <View style={styles.container}>
            <ScrollView
              ref={ref}
              style={commonStyles.scroll}
              contentContainerStyle={commonStyles.content}
              nestedScrollEnabled={true}
            >
              {logs.length === 0 ? (
                <Text style={commonStyles.empty}>Aucun log</Text>
              ) : (
                <LogList logs={logs} />
              )}
            </ScrollView>
          </View>
        )}
      </>
    );
  }
);

const LogList = ({ logs }: { logs: LogEntry[] }) => (
  <>
    {logs.map((log, index) => (
      <View key={index} style={commonStyles.entry}>
        <Text style={commonStyles.time}>{log.time}</Text>
        <Text style={[
          commonStyles.message,
          log.type === 'error' && commonStyles.error,
          log.type === 'success' && commonStyles.success,
          log.type === 'warning' && commonStyles.warning,
        ]}>
          {log.message}
        </Text>
      </View>
    ))}
  </>
);

const commonStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 10 },
  empty: { color: '#666', textAlign: 'center', padding: 20, fontStyle: 'italic' },
  entry: { marginBottom: 8 },
  time: { fontSize: 10, color: '#999', marginBottom: 2 },
  message: { fontSize: 12, color: '#fff' },
  error: { color: '#ff5252' },
  success: { color: '#4CAF50' },
  warning: { color: '#FFA726' },
});

const defaultStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    backgroundColor: '#757575',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginLeft: 8 },
  container: {
    marginTop: 15,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#333',
  },
});

const landscapeStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#757575',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
    gap: 6,
  },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    flex: 1,
    maxHeight: 120,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
});

const overlayStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.9)',
    maxHeight: 200,
    borderRadius: 15,
  },
  containerLandscape: { bottom: 70, maxHeight: 120 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  scroll: { maxHeight: 150, padding: 10 },
  scrollLandscape: { maxHeight: 80 },
  toggle: {
    position: 'absolute',
    top: 20,
    right: 15,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleLandscape: { top: 8, right: 8, width: 32, height: 32, borderRadius: 16 },
});

export default LogViewer;
