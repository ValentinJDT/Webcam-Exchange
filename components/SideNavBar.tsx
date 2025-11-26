import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

interface NavItem {
  name: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Gallery', label: 'Galerie', icon: 'images-outline' },
  { name: 'Client', label: 'Client', icon: 'camera-outline' },
  { name: 'Server', label: 'Serveur', icon: 'desktop-outline' },
];

export default function SideNavBar() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const currentRouteName = route.name;

  return (
    <View style={styles.sideNavBar}>
      {NAV_ITEMS.map((item) => {
        const isActive = currentRouteName === item.name;
        
        return (
          <TouchableOpacity
            key={item.name}
            style={[styles.sideNavButton]}
            onPress={() => !isActive && navigation.navigate(item.name)}
            disabled={isActive}
          >
            <View style={styles.sideNavIconRotated}>
              <Ionicons
                name={item.icon as any}
                size={20}
                color={isActive ? '#2196F3' : '#757575'}
              />
            </View>
            <View style={styles.sideNavTextContainer}>
              <Text style={[styles.sideNavText, isActive && styles.sideNavTextActive]}>
                {item.label}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sideNavBar: {
    width: 50,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderLeftColor: '#e0e0e0',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 10,
  },
  sideNavButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    width: '100%',
  },
  sideNavButtonActive: {
    backgroundColor: '#e3f2fd',
  },
  sideNavIconRotated: {
    transform: [],
  },
  sideNavTextContainer: {
    transform: [],
    marginTop: 8,
  },
  sideNavText: {
    fontSize: 9,
    color: '#757575',
    textAlign: 'center',
  },
  sideNavTextActive: {
    color: '#2196F3',
    fontWeight: '600',
  },
});
