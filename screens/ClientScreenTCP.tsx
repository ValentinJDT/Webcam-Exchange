import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
  MediaStream,
} from 'react-native-webrtc';
import TcpSocket from 'react-native-tcp-socket';
import Ionicons from '@react-native-vector-icons/ionicons';
import ViewShot, { captureRef } from 'react-native-view-shot';
import RNFS from 'react-native-fs';

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

export default function ClientScreenTCP() {
  const [serverIP, setServerIP] = useState('');
  const [serverPort, setServerPort] = useState('4747');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'front' | 'environment'>('environment');
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; type: string; message: string }>>([]);

  const socketRef = useRef<any>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const bufferRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);
  const viewShotRef = useRef<any>(null);

  const addLog = (type: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, type, message }]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const connectToStream = async () => {
    if (!serverIP.trim()) {
      Alert.alert('Erreur', "Veuillez entrer l'adresse IP du serveur");
      return;
    }

    setConnecting(true);

    try {
      // 1. Connexion TCP au serveur
      console.log(`[TCP Client] Connexion à ${serverIP}:${serverPort}...`);
      addLog('info', `🔌 Connexion à ${serverIP}:${serverPort}...`);

      const socket = TcpSocket.createConnection(
        {
          port: parseInt(serverPort),
          host: serverIP,
          reuseAddress: true,
        },
        () => {
          console.log('[TCP Client] Connecté au serveur TCP');
          addLog('success', `✅ Connecté au serveur TCP`);
          // Continuer avec WebRTC après connexion TCP réussie
          setupWebRTC(socket);
        },
      );

      socket.on('data', (data: any) => {
        try {
          bufferRef.current += data.toString();

          // Vérifier si on a reçu un message complet (terminé par \n)
          if (bufferRef.current.includes('\n')) {
            const messages = bufferRef.current.split('\n');
            bufferRef.current = messages.pop() || ''; // Garde le dernier fragment incomplet

            for (const message of messages) {
              if (!message.trim()) continue;

              const response = JSON.parse(message);
              console.log('[TCP Client] Message reçu:', response.type);
              addLog('info', `📨 Réponse reçue: ${response.type}`);

                if (response.type === 'answer') {
                  handleAnswer(response.answer, response.candidates);
                } else if (response.type === 'photo_saved') {
                  addLog('success', `✅ Photo sauvegardée sur le serveur: ${response.path}`);
                  Alert.alert('Photo sauvegardée', `Serveur: ${response.path}`);
                } else if (response.type === 'error') {
                  addLog('error', `❌ Erreur serveur: ${response.error}`);
                  throw new Error(response.error);
                }
            }
          }
        } catch (error: any) {
          console.error('[TCP Client] Erreur lors du traitement de la réponse:', error);
          addLog('error', `❌ Erreur traitement: ${error.message}`);
          Alert.alert('Erreur', error.message);
          disconnect();
        }
      });

      socket.on('error', (error: any) => {
        console.error('[TCP Client] Erreur TCP:', error);
        addLog('error', `❌ Erreur TCP: ${error.message}`);
        Alert.alert('Erreur de connexion', error.message);
        setConnecting(false);
        disconnect();
      });

      socket.on('close', () => {
        console.log('[TCP Client] Connexion TCP fermée');
        addLog('warning', '⚠️ Connexion TCP fermée');
        if (connected) {
          Alert.alert('Déconnecté', 'La connexion avec le serveur a été perdue');
        }
        disconnect();
      });

      socketRef.current = socket;
    } catch (error: any) {
      console.error('[TCP Client] Erreur de connexion:', error);
      addLog('error', `❌ Erreur connexion: ${error.message}`);
      Alert.alert('Erreur de connexion', error.message);
      setConnecting(false);
      disconnect();
    }
  };

  const setupWebRTC = async (socket: any) => {
    try {
      // 2. Créer une connexion peer
      console.log('[TCP Client] Création de la connexion WebRTC...');
      addLog('info', '🔧 Création connexion WebRTC...');
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;

      // 1. Obtenir le flux local (caméra) et l'ajouter aux senders
      try {
        const stream = await mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        setLocalStream(stream);
        stream.getTracks().forEach((track: any) => peerConnection.addTrack(track, stream));
        addLog('info', '📹 Flux local ajouté');
      } catch (err: any) {
        console.error('[TCP Client] Impossible d accéder à la caméra:', err);
        addLog('error', `❌ Permission caméra: ${err.message}`);
        Alert.alert('Erreur', 'Impossible d accéder à la caméra');
        setConnecting(false);
        socket.destroy();
        return;
      }

      // (Optionnel) gérer le stream distant si le serveur renverra quelque chose
      (peerConnection as any).ontrack = (event: any) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      // Collecter les candidats ICE
      const iceCandidates: RTCIceCandidate[] = [];
      (peerConnection as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          console.log('[TCP Client] ICE candidate:', event.candidate.type);
          iceCandidates.push(event.candidate);
        }
      };

      // Gérer les changements de connexion
      (peerConnection as any).onconnectionstatechange = () => {
        console.log('[TCP Client] État de connexion:', peerConnection.connectionState);
        addLog('info', `📊 État WebRTC: ${peerConnection.connectionState}`);

        if (peerConnection.connectionState === 'connected') {
          addLog('success', '✅ Connexion WebRTC active');
        } else if (
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected'
        ) {
          addLog('warning', '⚠️ Connexion WebRTC perdue');
          disconnect();
          Alert.alert('Déconnecté', 'La connexion WebRTC a été perdue');
        }
      };

      // 3. Créer une offre
      console.log("[TCP Client] Création de l'offre...");
      addLog('info', "📝 Création de l'offre WebRTC...");
      // Créer une offre (nous envoyons désormais le flux local)
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Attendre la collecte des candidats ICE
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      // 4. Envoyer l'offre au serveur via TCP
      console.log("[TCP Client] Envoi de l'offre au serveur...");
      addLog('info', "📤 Envoi de l'offre au serveur...");
      const offerMessage = JSON.stringify({
        type: 'offer',
        offer: offer,
        candidates: iceCandidates,
      });

      socket.write(offerMessage + '\n');
    } catch (error: any) {
      console.error('[TCP Client] Erreur WebRTC:', error);
      addLog('error', `❌ Erreur WebRTC: ${error.message}`);
      Alert.alert('Erreur WebRTC', error.message);
      setConnecting(false);
      disconnect();
    }
  };

  const handleAnswer = async (answer: any, candidates: RTCIceCandidate[]) => {
    try {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        throw new Error('PeerConnection non initialisée');
      }

      console.log('[TCP Client] Application de la réponse...');
      addLog('info', '🔧 Application de la réponse...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

      // Ajouter les candidats ICE du serveur
      for (const candidate of candidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }

      console.log('[TCP Client] Connexion WebRTC établie!');
      addLog('success', '✅ Connexion WebRTC établie!');
      setConnecting(false);
      setConnected(true);
    } catch (error: any) {
      console.error("[TCP Client] Erreur lors de l'application de la réponse:", error);
      addLog('error', `❌ Erreur réponse: ${error.message}`);
      Alert.alert('Erreur', error.message);
      disconnect();
    }
  };

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.destroy();
      socketRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setConnected(false);
    setRemoteStream(null);
    setConnecting(false);
    bufferRef.current = '';
  };

  const capturePhoto = async () => {
    try {
      if (!localStream) {
        Alert.alert('Erreur', 'Aucun flux vidéo disponible');
        return;
      }

      addLog('info', '📸 Capture en cours...');

      // Utiliser captureRef pour capturer la vue RTCView
      // On capture directement depuis le viewShotRef
      if (!viewShotRef.current) {
        throw new Error('Référence de vue non disponible');
      }

      // Capturer avec une qualité maximale
      const uri = await captureRef(viewShotRef, {
        format: 'jpg',
        quality: 1.0,
        result: 'tmpfile', // Sauvegarder temporairement comme fichier
      });

      // Lire le fichier en base64
      const base64 = await RNFS.readFile(uri, 'base64');
      
      // Supprimer le fichier temporaire
      await RNFS.unlink(uri).catch(() => {});

      console.log('[Client] Capture réussie, taille:', base64.length, 'caractères');
      console.log('[Client] Premiers caractères:', base64.substring(0, 50));

      const filename = `photo_${Date.now()}.jpg`;

      // Envoyer au serveur via le socket TCP
      if (!socketRef.current) {
        Alert.alert('Erreur', "Pas de connexion au serveur");
        return;
      }

      addLog('info', `📤 Envoi de la photo (${filename}) au serveur...`);
      const message = JSON.stringify({ type: 'photo', filename, data: base64 });
      socketRef.current.write(message + '\n');

      addLog('success', `✅ Photo envoyée: ${filename}`);
      Alert.alert('Photo envoyée', 'La photo a été envoyée au serveur');
    } catch (err: any) {
      console.error('[TCP Client] capturePhoto error', err);
      addLog('error', `❌ Erreur capture: ${err?.message || err}`);
      Alert.alert('Erreur', `Impossible de capturer la photo: ${err?.message || err}`);
    }
  };

  const toggleCamera = async () => {
    if (!peerConnectionRef.current) return;
    try {
      const newFacing = facingMode === 'front' ? 'environment' : 'front';
      addLog('info', `🔁 Changement caméra → ${newFacing}`);

      const newStream = await mediaDevices.getUserMedia({
        video: {
          facingMode: newFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      const videoTrack = newStream.getVideoTracks()[0];
      const pc = peerConnectionRef.current;
      const sender = pc.getSenders().find((s: any) => s.track?.kind === 'video');

      if (sender) {
        // Replace the outgoing track with the new camera track
        await sender.replaceTrack(videoTrack);
        addLog('success', '✅ Piste vidéo remplacée');
      } else {
        pc.addTrack(videoTrack, newStream);
        addLog('success', '✅ Piste vidéo ajoutée');
      }

      // Stop previous local tracks
      if (localStream) {
        localStream.getTracks().forEach((t: any) => t.stop());
      }

      setLocalStream(newStream);
      setFacingMode(newFacing);
    } catch (err: any) {
      console.error('[TCP Client] toggleCamera error', err);
      addLog('error', `❌ Erreur changement caméra: ${err?.message || err}`);
      Alert.alert('Erreur', `Impossible de changer de caméra: ${err?.message || err}`);
    }
  };

  return (
    <View style={styles.container}>
      {!connected && !connecting ? (
        <ScrollView style={styles.connectionContainer} contentContainerStyle={styles.scrollContent}>
          <View style={styles.formContainer}>
            <Text style={styles.label}>Adresse IP du serveur:</Text>
            <TextInput
              style={styles.input}
              placeholder="192.168.1.10"
              value={serverIP}
              onChangeText={setServerIP}
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Port du serveur:</Text>
            <TextInput
              style={styles.input}
              placeholder="4747"
              value={serverPort}
              onChangeText={setServerPort}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[styles.button, !serverIP && styles.buttonDisabled]}
              onPress={connectToStream}
              disabled={!serverIP}
            >
              <Text style={styles.buttonText}>📡 Se Connecter</Text>
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>💡 Comment se connecter?</Text>
              <Text style={styles.infoText}>
                  1. Le serveur doit avoir démarré{"\n"}
                  2. Demandez l'adresse IP du serveur{"\n"}
                  3. Entrez l'IP ci-dessus{"\n"}
                  4. Appuyez sur "Se Connecter"{"\n"}
                  5. Le client commencera à envoyer son flux automatiquement
                </Text>
            </View>

            <View style={styles.exampleBox}>
              <Text style={styles.exampleTitle}>Exemple d'adresse:</Text>
              <Text style={styles.exampleText}>
                IP: 192.168.1.10{'\n'}
                Port: 4747
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
          </View>
        </ScrollView>
      ) : connecting ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Connexion au serveur...</Text>
          <Text style={styles.loadingSubtext}>
            {serverIP}:{serverPort}
          </Text>

          <TouchableOpacity
            style={styles.logButtonConnecting}
            onPress={() => setShowLogs(!showLogs)}
          >
            <Text style={styles.logButtonText}>
              {showLogs ? '📋 Masquer les logs' : '📋 Afficher les logs'}
            </Text>
          </TouchableOpacity>

          {showLogs && (
            <View style={styles.logContainerConnecting}>
              <ScrollView
                ref={scrollViewRef}
                style={styles.logScroll}
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
          ) : (
            <View style={styles.streamContainer}>
          {/* The server does not send a stream; show local camera fullscreen */}
          {localStream ? (
            <ViewShot ref={viewShotRef} options={{ result: 'base64', format: 'jpg', quality: 0.9 }} style={{ flex: 1 }}>
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.streamView}
                objectFit="cover"
                mirror={facingMode === 'front'}
              />
            </ViewShot>
          ) : (
            <View style={styles.waitingContainer}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.waitingText}>En attente du flux local...</Text>
            </View>
          )}

          <View style={styles.overlayControls}>
            <View style={styles.statusBar}>
              <View style={styles.ipDisplay}>
                <Text style={styles.ipDisplayText}>
                  📡 {serverIP}:{serverPort}
                </Text>
              </View>

              <View style={{ width: 48 }} />
            </View>

            <View style={styles.controlButtons}>
              <TouchableOpacity
                style={[styles.controlButton, styles.captureButton]}
                onPress={capturePhoto}
                accessibilityLabel="Capturer la photo"
              >
                <Ionicons name="camera-outline" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton]}
                onPress={toggleCamera}
                accessibilityLabel="Changer la caméra"
              >
                <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.controlButton}
                onPress={() => setShowLogs(!showLogs)}
                accessibilityLabel="Afficher les logs"
              >
                <Ionicons name="clipboard-outline" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, styles.disconnectButton]}
                onPress={disconnect}
                accessibilityLabel="Se déconnecter"
              >
                <Ionicons name="close-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {showLogs && (
            <View style={styles.logOverlay}>
              <View style={styles.logHeader}>
                <Text style={styles.logHeaderText}>📋 Logs Client</Text>
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
  connectionContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    backgroundColor: '#2196F3',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  formContainer: {
    padding: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 15,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoBox: {
    marginTop: 30,
    backgroundColor: '#e3f2fd',
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976D2',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
  },
  exampleBox: {
    marginTop: 15,
    backgroundColor: '#FFF3E0',
    padding: 15,
    borderRadius: 10,
  },
  exampleTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 5,
  },
  exampleText: {
    fontSize: 13,
    color: '#E65100',
    fontFamily: 'monospace',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  loadingSubtext: {
    marginTop: 10,
    fontSize: 14,
    color: '#999',
    fontFamily: 'monospace',
  },
  streamContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  streamView: {
    flex: 1,
    backgroundColor: '#000',
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
  overlayControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  liveIndicator: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    margin: 15,
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
  serverInfo: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  serverInfoText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingTop: 18,
  },
  ipDisplay: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    justifyContent: 'center',
  },
  ipDisplayText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  controlButtons: {
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
  captureButton: {
    backgroundColor: '#4CAF50',
  },
  disconnectButton: {
    backgroundColor: '#f44336',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
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
  logButtonConnecting: {
    backgroundColor: '#757575',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 30,
    marginHorizontal: 20,
  },
  logContainerConnecting: {
    marginTop: 15,
    marginHorizontal: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#333',
  },
  // local preview removed: we show localStream fullscreen instead
});
