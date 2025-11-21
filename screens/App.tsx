import React from 'react';
import { Text, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'react-native';
import ServerScreenTCP from './ServerScreenTCP';
import ClientScreenTCP from './ClientScreenTCP';

const Tab = createBottomTabNavigator();

function Tabs() {
  const insets = useSafeAreaInsets();

  const bottomPadding = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 20 : 5);
  const barHeight = Platform.OS === 'android' ? 60 + insets.bottom : 60;

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: '#757575',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e0e0e0',
          paddingBottom: bottomPadding,
          paddingTop: 5,
          height: barHeight,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: '#2196F3',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Tab.Screen
        name="Server"
        component={ServerScreenTCP}
        options={{
          tabBarLabel: 'Serveur',
          tabBarIcon: ({ color, size }) => (
            <TabIcon emoji="🎥" color={color} />
          ),
          headerTitle: 'Serveur TCP',
        }}
      />
      <Tab.Screen
        name="Client"
        component={ClientScreenTCP}
        options={{
          tabBarLabel: 'Viewer',
          tabBarIcon: ({ color, size }) => (
            <TabIcon emoji="📱" color={color} />
          ),
          headerTitle: 'Viewer TCP',
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer>
        <Tabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

// Composant helper pour les icônes emoji dans les tabs
function TabIcon({ emoji, color }: { emoji: string; color: string }) {
  return (
    <Text style={{ fontSize: 24, color }}>
      {emoji}
    </Text>
  );
}
