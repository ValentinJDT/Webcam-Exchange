import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface InfoBoxProps {
  title: string;
  children: React.ReactNode;
  variant?: 'blue' | 'orange';
  isLandscape?: boolean;
}

export default function InfoBox({ title, children, variant = 'blue', isLandscape = false }: InfoBoxProps) {
  const colors = variant === 'blue' 
    ? { bg: '#e3f2fd', border: '#2196F3', title: '#1976D2', text: '#555' }
    : { bg: '#FFF3E0', border: '#FF9800', title: '#E65100', text: '#E65100' };

  return (
    <View style={[
      styles.container,
      isLandscape && styles.containerLandscape,
      { backgroundColor: colors.bg, borderLeftColor: colors.border }
    ]}>
      <Text style={[
        styles.title,
        isLandscape && styles.titleLandscape,
        { color: colors.title }
      ]}>
        {title}
      </Text>
      <Text style={[
        styles.text,
        isLandscape && styles.textLandscape,
        { color: colors.text }
      ]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 30,
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
  },
  containerLandscape: {
    marginTop: 0,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  titleLandscape: {
    fontSize: 13,
    marginBottom: 4,
  },
  text: {
    fontSize: 14,
    lineHeight: 24,
  },
  textLandscape: {
    fontSize: 12,
    lineHeight: 18,
  },
});
