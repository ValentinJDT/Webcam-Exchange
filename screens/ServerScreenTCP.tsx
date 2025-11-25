import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ScrollView, Animated, PermissionsAndroid, Platform, ActivityIndicator } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
  MediaStream,
} from 'react-native-webrtc';
import Clipboard from '@react-native-clipboard/clipboard';
import RNFS from 'react-native-fs';
import { NetworkInfo } from 'react-native-network-info';
import TcpSocket from 'react-native-tcp-socket';

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

const SIGNALING_PORT = 4747;

interface Client {
  socket: any;
  peerConnection: RTCPeerConnection;
  iceCandidates: RTCIceCandidate[];
  remoteStream?: MediaStream | null;
}

export default function ServerScreenTCP() {
  // We'll request platform permissions manually (PermissionsAndroid on Android).
  const [streaming, setStreaming] = useState(false);
  // server no longer captures or sends its own local stream
  const [ipAddress, setIpAddress] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'front' | 'environment'>('environment');
  const [serverStarted, setServerStarted] = useState(false);
  const [connectedClients, setConnectedClients] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; type: string; message: string }>>([]);
  const [tooltipText, setTooltipText] = useState('');
  const tooltipTimeoutRef = useRef<any>(null);
  const tooltipAnim = useRef(new Animated.Value(0)).current;
  const setupScrollRef = useRef<ScrollView>(null);

  const serverRef = useRef<any>(null);
  const clientsRef = useRef<Map<string, Client>>(new Map());
  const scrollViewRef = useRef<ScrollView>(null);
  const [clientsVersion, setClientsVersion] = useState(0);

  const addLog = (type: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, type, message }]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    getIPAddress();
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      stopStreaming();
      stopSignalingServer();
    };
  }, []);

  // server does not request camera/media permissions anymore

  const showTooltip = (text: string, duration = 3000) => {
    setTooltipText(text);
    // animate in
    tooltipAnim.setValue(0);
    Animated.timing(tooltipAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      Animated.timing(tooltipAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }, duration);
  };

  const getIPAddress = async () => {
    try {
      let ip = null;
      if (NetworkInfo && NetworkInfo.getIPV4Address) {
        ip = await NetworkInfo.getIPV4Address();
      }
      setIpAddress(ip || 'Non disponible');
    } catch (error) {
      console.error("Erreur lors de la récupération de l'IP:", error);
      setIpAddress('Non disponible');
    }
  };

  const startSignalingServer = async () => {
    try {
      addLog('info', '🚀 Démarrage du serveur TCP...');
      const server = TcpSocket.createServer((socket: any) => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[TCP Server] Nouveau client connecté: ${clientId}`);
        addLog('success', `✅ Nouveau client: ${clientId}`);

        let buffer = '';

        socket.on('data', async (data: any) => {
          try {
            buffer += data.toString();

            // Vérifier si on a reçu un message complet (terminé par \n)
            if (buffer.includes('\n')) {
              const messages = buffer.split('\n');
              buffer = messages.pop() || ''; // Garde le dernier fragment incomplet

              for (const message of messages) {
                if (!message.trim()) continue;

                const request = JSON.parse(message);
                console.log(`[TCP Server] Message reçu de ${clientId}:`, request.type);
                addLog('info', `📨 Offre reçue de ${clientId.split(':')[0]}`);

                if (request.type === 'offer') {
                  await handleOffer(clientId, socket, request.offer, request.candidates);
                } else if (request.type === 'photo') {
                  // Photo (base64) reçu du client
                  await handlePhoto(clientId, socket, request.filename, request.data);
                }
              }
            }
          } catch (error: any) {
            console.error(`[TCP Server] Erreur lors du traitement des données:`, error);
            addLog('error', `❌ Erreur traitement: ${error.message}`);
            socket.write(
              JSON.stringify({
                type: 'error',
                error: error.message,
              }) + '\n',
            );
          }
        });

        socket.on('error', (error: any) => {
          console.error(`[TCP Server] Erreur avec le client ${clientId}:`, error);
          addLog('error', `❌ Erreur client: ${error.message}`);
          cleanupClient(clientId);
        });

        socket.on('close', () => {
          console.log(`[TCP Server] Client déconnecté: ${clientId}`);
          addLog('warning', `⚠️ Client déconnecté: ${clientId.split(':')[0]}`);
          cleanupClient(clientId);
        });
      }).listen({ port: SIGNALING_PORT, host: '0.0.0.0' }, () => {
        console.log(`[TCP Server] Serveur en écoute sur le port ${SIGNALING_PORT}`);
        addLog('success', `✅ Serveur TCP démarré sur :${SIGNALING_PORT}`);
      });

      server.on('error', (error: any) => {
        console.error('[TCP Server] Erreur du serveur:', error);
        addLog('error', `❌ Erreur serveur: ${error.message}`);
        Alert.alert('Erreur serveur', error.message);
      });

      serverRef.current = server;
      setServerStarted(true);
    } catch (error: any) {
      console.error('[TCP Server] Erreur lors du démarrage:', error);
      addLog('error', `❌ Démarrage impossible: ${error.message}`);
      Alert.alert('Erreur', `Impossible de démarrer le serveur: ${error.message}`);
    }
  };

  const handlePhoto = async (clientId: string, socket: any, filename: string, base64Data: string) => {
    try {
      addLog('info', `📥 Photo reçue de ${clientId.split(':')[0]} — sauvegarde...`);

      // Utiliser le répertoire Pictures pour que les photos soient visibles dans la galerie
      let appDir: string;
      
      if (Platform.OS === 'android') {
        // Android: Utiliser Pictures/WebcamExchange (visible dans la galerie)
        const picturesPath = RNFS.PicturesDirectoryPath || `${RNFS.ExternalStorageDirectoryPath}/Pictures`;
        appDir = `${picturesPath}/WebcamExchange`;
      } else {
        // iOS: Utiliser le répertoire Documents
        appDir = `${RNFS.DocumentDirectoryPath}/WebcamExchange`;
      }
      
      console.log('Répertoire cible:', appDir);
      
      // Vérifier et créer le répertoire avec gestion d'erreur robuste
      try {
        const dirExists = await RNFS.exists(appDir).catch(() => false);
        console.log('Le répertoire existe:', dirExists);
        
        if (!dirExists) {
          console.log('Création du répertoire...');
          await RNFS.mkdir(appDir).catch((err) => {
            console.warn('Erreur mkdir (peut-être déjà existant):', err);
          });
        }
      } catch (dirError) {
        console.warn('Erreur lors de la vérification/création du répertoire:', dirError);
        // Continuer quand même, le répertoire existe peut-être
      }
      
      const filePath = `${appDir}/${filename}`;
      console.log('Chemin complet du fichier:', filePath);
      console.log('Taille des données reçues:', base64Data?.length || 0, 'caractères');
      console.log('Premier caractères:', base64Data?.substring(0, 50));
      
      // Nettoyer les données base64 (enlever le préfixe data: si présent)
      let cleanBase64 = base64Data;
      if (base64Data.startsWith('data:')) {
        const base64Index = base64Data.indexOf('base64,');
        if (base64Index !== -1) {
          cleanBase64 = base64Data.substring(base64Index + 7);
          console.log('Préfixe data: détecté et retiré');
        }
      }
      
      console.log('Taille des données nettoyées:', cleanBase64?.length || 0, 'caractères');

      // Écrire le fichier avec gestion d'erreur robuste
      let writeSuccess = false;
      try {
        await RNFS.writeFile(filePath, cleanBase64, 'base64').catch((writeErr) => {
          console.error('Erreur writeFile brute:', writeErr);
          throw new Error(`Échec d'écriture: ${writeErr?.message || writeErr || 'inconnu'}`);
        });
        writeSuccess = true;
        console.log('Photo sauvegardée avec succès');
      } catch (writeError: any) {
        console.error('Erreur lors de l\'écriture:', writeError);
        throw new Error(`Impossible de sauvegarder: ${writeError?.message || 'erreur d\'écriture'}`);
      }

      if (!writeSuccess) {
        throw new Error('Échec de sauvegarde sans erreur explicite');
      }

      addLog('success', `✅ Photo sauvegardée: ${filePath}`);

      // Répondre au client
      socket.write(JSON.stringify({ type: 'photo_saved', path: filePath }) + '\n');
    } catch (error: any) {
      const errorMessage = error?.message || 'Erreur de sauvegarde inconnue';
      console.error('[TCP Server] handlePhoto error:', error);
      addLog('error', `❌ Erreur sauvegarde photo: ${errorMessage}`);
      
      try {
        socket.write(JSON.stringify({ type: 'error', error: errorMessage }) + '\n');
      } catch (writeErr) {
        console.error('[TCP Server] Impossible d\'envoyer l\'erreur au client:', writeErr);
      }
    }
  };

  const stopSignalingServer = () => {
    if (serverRef.current) {
      serverRef.current.close();
      serverRef.current = null;
      setServerStarted(false);
      console.log('[TCP Server] Arrêté');
    }

    // Fermer toutes les connexions clients
    clientsRef.current.forEach((client) => {
      client.peerConnection.close();
      client.socket.destroy();
    });
    clientsRef.current.clear();
    setConnectedClients(0);
  };

  const handleOffer = async (
    clientId: string,
    socket: any,
    offer: any,
    candidates: any[],
  ) => {
    try {
      const peerConnection = new RTCPeerConnection(configuration);
      const iceCandidates: RTCIceCandidate[] = [];

      // Collecter les candidats ICE
      (peerConnection as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          console.log('[TCP Server] ICE candidate:', event.candidate.type);
          iceCandidates.push(event.candidate);
        }
      };

      // Gérer les tracks entrants (flux envoyés par le client)
      (peerConnection as any).ontrack = (event: any) => {
        console.log('[TCP Server] Track reçu de', clientId, 'streams:', event.streams?.length);
        addLog('success', `✅ Flux reçu de ${clientId.split(':')[0]}`);
        if (event.streams && event.streams[0]) {
          const client = clientsRef.current.get(clientId);
          if (client) {
            client.remoteStream = event.streams[0];
            clientsRef.current.set(clientId, client);
            setConnectedClients(clientsRef.current.size);
                setClientsVersion((v) => v + 1);
          }
          // If no client selected, auto-select the first
          if (!selectedClientId) {
            setSelectedClientId(clientId);
          }
        }
      };


      // Gérer les changements de connexion
      (peerConnection as any).onconnectionstatechange = () => {
        console.log(`[WebRTC] État de connexion pour ${clientId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          addLog('success', `✅ WebRTC connecté: ${clientId.split(':')[0]}`);
          setConnectedClients(clientsRef.current.size);
        } else if (
          peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed'
        ) {
          addLog('warning', `⚠️ WebRTC déconnecté: ${clientId.split(':')[0]}`);
          cleanupClient(clientId);
        }
      };

      // Stocker le client (remoteStream sera rempli par ontrack)
      clientsRef.current.set(clientId, {
        socket,
        peerConnection,
        iceCandidates,
        remoteStream: null,
      });


      // Définir l'offre distante
      await peerConnection.setRemoteDescription(offer);

      // Ajouter les candidats ICE du client
      for (const candidate of candidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Créer la réponse
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Attendre que les candidats ICE soient collectés
      setTimeout(() => {
        const response = JSON.stringify({
          type: 'answer',
          answer: peerConnection.localDescription,
          candidates: iceCandidates,
        });

        socket.write(response + '\n');
        console.log(`[TCP Server] Réponse envoyée à ${clientId}`);
        addLog('info', `📤 Réponse envoyée à ${clientId.split(':')[0]}`);
      }, 3000);
    } catch (error: any) {
      console.error(`[WebRTC] Erreur pour ${clientId}:`, error);
      addLog('error', `❌ Erreur WebRTC: ${error.message}`);
      socket.write(
        JSON.stringify({
          type: 'error',
          error: error.message,
        }) + '\n',
      );
    }
  };

  const cleanupClient = (clientId: string) => {
    const client = clientsRef.current.get(clientId);
    if (client) {
      client.peerConnection.close();
      client.socket.destroy();
      clientsRef.current.delete(clientId);
      setConnectedClients(clientsRef.current.size);
      setClientsVersion((v) => v + 1);
      if (selectedClientId === clientId) setSelectedClientId(null);
    }
  };

  const startStreaming = async () => {
    try {
      addLog('info', '🚀 Démarrage du serveur signaling...');
      await startSignalingServer();
      setStreaming(true);
      Alert.alert('Serveur démarré', `Les clients peuvent se connecter à:\n${ipAddress}:${SIGNALING_PORT}`);
    } catch (error: any) {
      addLog('error', `❌ Erreur démarrage: ${error.message}`);
      Alert.alert('Erreur', `Impossible de démarrer: ${error.message}`);
    }
  };

  const stopStreaming = () => {
    // Arrêter le serveur signaling
    stopSignalingServer();
    setStreaming(false);
  };

  // toggleCamera removed: server no longer sends its own stream

  return (
    <View style={styles.container}>
      {!streaming ? (
        <ScrollView style={styles.setupContainer} contentContainerStyle={styles.setupContent} ref={setupScrollRef}>

          <View style={styles.ipCard}>
            <Text style={styles.ipLabel}>Votre adresse IP:</Text>
            <Text style={styles.ipAddress}>{ipAddress || 'Chargement...'}</Text>
            <Text style={styles.ipHint}>
              Les clients devront se connecter à:{'\n'}
              {ipAddress}:{SIGNALING_PORT}
            </Text>
          </View>

          <TouchableOpacity style={styles.startButton} onPress={startStreaming}>
            <Text style={styles.startButtonText}>🔌 Démarrer le serveur</Text>
          </TouchableOpacity>

          <View style={styles.instructionsCard}>
            <Text style={styles.instructionsTitle}>💡 Instructions:</Text>
            <Text style={styles.instructionsText}>
              1. Appuyez sur "Démarrer le serveur"{'\n'}
              2. Communiquez votre IP aux clients{'\n'}
              3. Les clients se connectent automatiquement{'\n'}
              4. Les clients commenceront à envoyer leur flux automatiquement
            </Text>
          </View>

          <TouchableOpacity style={styles.logButton} onPress={() => setShowLogs(!showLogs)}>
            <Text style={styles.logButtonText}>
              {showLogs ? '📋 Masquer les logs' : '📋 Afficher les logs'}
            </Text>
          </TouchableOpacity>

          {showLogs && (
            <View style={styles.logContainer}>
              <ScrollView
                ref={scrollViewRef}
                style={styles.logScroll}
                contentContainerStyle={styles.logContent}
              >
                {logs.length === 0 ? (
                  <Text style={styles.logEmpty}>Aucun log pour le moment</Text>
                ) : (
                  logs.map((log, index) => (
                    <View key={index} style={styles.logEntry}>
                      <Text style={styles.logTime}>{log.time}</Text>
                      <Text
                        style={[
                          styles.logMessage,
                          log.type === 'error' && styles.logError,
                          log.type === 'success' && styles.logSuccess,
                          log.type === 'warning' && styles.logWarning,
                        ]}
                      >
                        {log.message}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.streamingContainer}>
          {/* Display selected client's stream (server no longer sends its own stream) */}
          {
            (() => {
              const client = selectedClientId ? clientsRef.current.get(selectedClientId) : null;
              const stream = client?.remoteStream || null;
              if (stream) {
                return (
                  <RTCView
                    streamURL={stream.toURL()}
                    style={styles.preview}
                    objectFit="cover"
                    mirror={false}
                  />
                );
              }

              return (
                <View style={styles.preview}>
                  <View style={styles.waitingContainer}>
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={styles.waitingText}>En attente du flux client...</Text>
                  </View>
                </View>
              );
            })()
          }

          <View style={styles.overlay}>
              <View style={styles.topBanner}>
                    <TouchableOpacity
                      onPress={() => {
                        try {
                          const text = `${ipAddress}:${SIGNALING_PORT}`;
                          Clipboard.setString(text);
                          addLog('success', `📋 IP copiée: ${text}`);
                          showTooltip(`IP copiée: ${text}`);
                        } catch (err: any) {
                          addLog('error', `❌ Impossible de copier l'IP: ${err.message}`);
                          Alert.alert('Erreur', `Impossible de copier l'IP: ${err.message}`);
                        }
                      }}
                    >
                      <Text style={styles.topBannerText}>📡 {ipAddress}:{SIGNALING_PORT}</Text>
                    </TouchableOpacity>

                    <Text style={styles.topBannerText}>👥 {connectedClients}</Text>
                  </View>

            {/* Client selector row */}
            <View style={styles.clientSelector}>
              <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 12 }}>
                {Array.from(clientsRef.current.keys()).length === 0 ? (
                  <Text style={{ color: '#fff', padding: 8 }}>Aucun client connecté</Text>
                ) : (
                  Array.from(clientsRef.current.keys()).map((id) => (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setSelectedClientId(id)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        marginRight: 8,
                        backgroundColor: selectedClientId === id ? '#1976D2' : 'rgba(255,255,255,0.06)',
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>{id.split(':')[0]}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>

            <View style={styles.controls}>
              <TouchableOpacity style={[styles.controlButton, { backgroundColor: '#757575' }]} onPress={() => setShowLogs(!showLogs)} accessibilityLabel="Afficher les logs">
                <Ionicons name="document-text-outline" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, styles.stopButton]}
                onPress={stopStreaming}
                accessibilityLabel="Arrêter le serveur"
              >
                <Ionicons name="stop-circle-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {showLogs && (
            <View style={styles.logOverlay}>
              <View style={styles.logHeader}>
                <Text style={styles.logHeaderText}>📋 Logs Serveur</Text>
                <TouchableOpacity onPress={() => setShowLogs(false)}>
                  <Text style={styles.logCloseButton}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={scrollViewRef}
                style={styles.logScrollOverlay}
                contentContainerStyle={styles.logContent}
              >
                {logs.length === 0 ? (
                  <Text style={styles.logEmpty}>Aucun log</Text>
                ) : (
                  logs.map((log, index) => (
                    <View key={index} style={styles.logEntry}>
                      <Text style={styles.logTime}>{log.time}</Text>
                      <Text
                        style={[
                          styles.logMessage,
                          log.type === 'error' && styles.logError,
                          log.type === 'success' && styles.logSuccess,
                          log.type === 'warning' && styles.logWarning,
                        ]}
                      >
                        {log.message}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  setupContainer: {
    flex: 1,
    padding: 20,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  ipCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  ipLabel: {
    fontSize: 14,
    color: '#1976D2',
    marginBottom: 5,
  },
  ipAddress: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0D47A1',
    marginBottom: 10,
  },
  ipHint: {
    fontSize: 12,
    color: '#1976D2',
    textAlign: 'center',
    marginTop: 5,
  },
  startButton: {
    backgroundColor: '#4CAF50',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  instructionsCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 15,
    padding: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 10,
  },
  instructionsText: {
    fontSize: 13,
    color: '#E65100',
    lineHeight: 22,
  },
  streamingContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  preview: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 15,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff0000',
    marginRight: 6,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clientsIndicator: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  clientsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  infoOverlay: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  overlayText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 2,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  controlButton: {
    minWidth: 56,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  logButton: {
    backgroundColor: '#757575',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  logButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logContainer: {
    marginTop: 15,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#333',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 10,
  },
  logEmpty: {
    color: '#666',
    textAlign: 'center',
    padding: 20,
    fontStyle: 'italic',
  },
  logEntry: {
    marginBottom: 8,
  },
  logTime: {
    fontSize: 10,
    color: '#999',
    marginBottom: 2,
  },
  logMessage: {
    fontSize: 12,
    color: '#fff',
  },
  logError: {
    color: '#ff5252',
  },
  logSuccess: {
    color: '#4CAF50',
  },
  logWarning: {
    color: '#FFA726',
  },
  logOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    maxHeight: '40%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  logHeaderText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logCloseButton: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  logScrollOverlay: {
    flex: 1,
  },
  ipButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ipButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 8,
    borderRadius: 10,
    marginRight: 8,
  },
  ipEmoji: {
    fontSize: 18,
  },
  ipTooltip: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  ipTooltipText: {
    color: '#fff',
    fontSize: 12,
  },
  setupContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingBottom: 20,
  },
  topBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 30,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  waitingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#fff',
  },
  clientSelector: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    zIndex: 40,
  },
});
