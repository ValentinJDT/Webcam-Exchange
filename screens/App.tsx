import React from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from '@react-native-vector-icons/ionicons';

import ServerScreenTCP from './ServerScreenTCP';
import ClientScreenTCP from './ClientScreenTCP';
import GalleryScreen from './GalleryScreen';
import { useLandscapeMode } from '../utils/helpers';

const Tab = createBottomTabNavigator();

const SCREENS = [
  { name: 'Server', component: ServerScreenTCP, label: 'Serveur', icon: 'desktop-outline' },
  { name: 'Client', component: ClientScreenTCP, label: 'Client', icon: 'camera-outline' },
  { name: 'Gallery', component: GalleryScreen, label: 'Galerie', icon: 'images-outline' },
] as const;

function Tabs() {
  const insets = useSafeAreaInsets();
  const { isLandscape } = useLandscapeMode();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: '#757575',
        tabBarStyle: isLandscape 
          ? { display: 'none' } 
          : { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingBottom: insets.bottom, height: 56 + insets.bottom },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarItemStyle: { justifyContent: 'center' },
      }}
    >
      {SCREENS.map(({ name, component, label, icon }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={component}
          options={{
            tabBarLabel: label,
            tabBarIcon: ({ color, size }) => <Ionicons name={icon} size={size} color={color} />,
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
