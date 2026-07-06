import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const PAPER = "#FBF9F2";
const INK = "#0E0E10";
const INK4 = "#8A8990";
const ACCENT = "#7CB342";

export default function Layout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: PAPER, borderTopColor: "rgba(14,14,16,0.08)", height: 85, paddingBottom: 30, paddingTop: 8 },
      tabBarActiveTintColor: INK,
      tabBarInactiveTintColor: INK4,
      tabBarLabelStyle: { fontFamily: "System", fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
      headerStyle: { backgroundColor: PAPER },
      headerTitleStyle: { fontWeight: "700", fontSize: 17, color: INK },
      headerShadowVisible: false,
    }}>
      <Tabs.Screen name="index" options={{ title: "Identity", tabBarIcon: ({ color, size }) => <Ionicons name="finger-print-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="impact" options={{ title: "Impact", tabBarIcon: ({ color, size }) => <Ionicons name="analytics-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="badges" options={{ title: "Badges", tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="apps" options={{ title: "Apps", tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet", tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
