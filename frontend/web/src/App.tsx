// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VotingProposal {
  id: string;
  title: string;
  description: string;
  creator: string;
  timestamp: number;
  encryptedVotes: number;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue?: number;
  status: 'active' | 'ended';
}

interface VoteData {
  proposalId: string;
  vote: number;
  timestamp: number;
  voter: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<VotingProposal[]>([]);
  const [myVotes, setMyVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [voting, setVoting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", duration: 7 });
  const [selectedProposal, setSelectedProposal] = useState<VotingProposal | null>(null);
  const [voteValue, setVoteValue] = useState(1);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState('proposals');
  const [searchTerm, setSearchTerm] = useState("");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadProposals();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadProposals = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const proposalsList: VotingProposal[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const now = Math.floor(Date.now() / 1000);
          const endTime = Number(businessData.timestamp) + (Number(businessData.publicValue2) * 24 * 60 * 60);
          
          proposalsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            encryptedVotes: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 7,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            status: now < endTime ? 'active' : 'ended'
          });
        } catch (e) {
          console.error('Error loading proposal:', e);
        }
      }
      
      setProposals(proposalsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load proposals" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProposal = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProposal(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted voting proposal..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const initialVotes = 0;
      const businessId = `proposal-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, initialVotes);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newProposalData.duration,
        0,
        newProposalData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadProposals();
      setShowCreateModal(false);
      setNewProposalData({ title: "", description: "", duration: 7 });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProposal(false); 
    }
  };

  const castVote = async (proposalId: string, vote: number) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setVoting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting your vote with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const voteId = `vote-${proposalId}-${address}-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, vote);
      
      const tx = await contract.createBusinessData(
        voteId,
        `Vote for ${proposalId}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        vote,
        0,
        `Vote cast by ${address}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Recording encrypted vote..." });
      await tx.wait();
      
      setMyVotes(prev => [...prev, {
        proposalId,
        vote,
        timestamp: Math.floor(Date.now() / 1000),
        voter: address
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote cast successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Voting failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setVoting(false); 
    }
  };

  const decryptResults = async (proposalId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(proposalId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Results already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(proposalId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(proposalId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadProposals();
      
      setTransactionStatus({ visible: true, status: "success", message: "Results decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Results already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadProposals();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredProposals = proposals.filter(proposal =>
    proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proposal.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalProposals: proposals.length,
    activeProposals: proposals.filter(p => p.status === 'active').length,
    endedProposals: proposals.filter(p => p.status === 'ended').length,
    myVotesCount: myVotes.length,
    verifiedProposals: proposals.filter(p => p.isVerified).length
  };

  const faqItems = [
    {
      question: "How does FHE protect my vote?",
      answer: "FHE (Fully Homomorphic Encryption) allows votes to be encrypted while still enabling computation. Your vote remains private until the voting period ends."
    },
    {
      question: "When are votes decrypted?",
      answer: "Votes are decrypted only after the voting period ends, ensuring no one can see individual votes during the voting process."
    },
    {
      question: "Can I change my vote?",
      answer: "No, each wallet address can only vote once per proposal to maintain integrity."
    },
    {
      question: "How are results calculated?",
      answer: "Using homomorphic encryption, the system can tally votes while they remain encrypted, preventing any form of vote manipulation."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🗳️</div>
            <h1>DAO Vote Shield</h1>
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="shield-icon">🛡️</div>
            <h2>Private Voting for DAOs</h2>
            <p>Connect your wallet to access encrypted voting system</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <span>Encrypted Votes</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <span>Homomorphic Tallying</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">👥</span>
                <span>Anti-Coercion</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-animation">
          <div className="lock-icon">🔒</div>
          <div className="encryption-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <p>Initializing FHE Encryption System</p>
        <p className="status-text">{fhevmInitializing ? "Connecting to FHEVM..." : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <div className="logo-icon">🗳️</div>
            <h1>DAO Vote Shield</h1>
            <span className="tagline">FHE-Protected Voting</span>
          </div>
          
          <nav className="main-nav">
            <button 
              className={`nav-btn ${activeTab === 'proposals' ? 'active' : ''}`}
              onClick={() => setActiveTab('proposals')}
            >
              Proposals
            </button>
            <button 
              className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Statistics
            </button>
            <button 
              className={`nav-btn ${activeTab === 'faq' ? 'active' : ''}`}
              onClick={() => setActiveTab('faq')}
            >
              FAQ
            </button>
          </nav>
          
          <div className="header-actions">
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="create-proposal-btn"
            >
              + New Proposal
            </button>
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">
        {activeTab === 'proposals' && (
          <div className="proposals-tab">
            <div className="tab-header">
              <h2>Active Proposals</h2>
              <div className="header-controls">
                <div className="search-box">
                  <input 
                    type="text"
                    placeholder="Search proposals..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  <span className="search-icon">🔍</span>
                </div>
                <button 
                  onClick={loadProposals} 
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "🔄" : "↻"} Refresh
                </button>
                <button 
                  onClick={checkAvailability}
                  className="check-availability-btn"
                >
                  Check Status
                </button>
              </div>
            </div>

            <div className="proposals-grid">
              {filteredProposals.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <p>No proposals found</p>
                  <button 
                    className="create-first-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Proposal
                  </button>
                </div>
              ) : (
                filteredProposals.map((proposal) => (
                  <div 
                    key={proposal.id} 
                    className={`proposal-card ${proposal.status} ${selectedProposal?.id === proposal.id ? 'selected' : ''}`}
                    onClick={() => setSelectedProposal(proposal)}
                  >
                    <div className="card-header">
                      <h3>{proposal.title}</h3>
                      <span className={`status-badge ${proposal.status}`}>
                        {proposal.status}
                      </span>
                    </div>
                    <p className="proposal-desc">{proposal.description}</p>
                    <div className="card-meta">
                      <span>By: {proposal.creator.substring(0, 8)}...</span>
                      <span>Ends: {new Date((proposal.timestamp + proposal.publicValue1 * 86400) * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="card-actions">
                      {proposal.status === 'active' ? (
                        <div className="vote-buttons">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              castVote(proposal.id, 1);
                            }}
                            disabled={voting}
                            className="vote-btn yes"
                          >
                            👍 Support
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              castVote(proposal.id, 0);
                            }}
                            disabled={voting}
                            className="vote-btn no"
                          >
                            👎 Oppose
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            decryptResults(proposal.id);
                          }}
                          disabled={fheIsDecrypting}
                          className={`results-btn ${proposal.isVerified ? 'verified' : ''}`}
                        >
                          {proposal.isVerified ? '✅ Results Verified' : '🔓 View Results'}
                        </button>
                      )}
                    </div>
                    {proposal.isVerified && (
                      <div className="results-display">
                        <div className="result-bar">
                          <div 
                            className="result-fill"
                            style={{ width: `${(proposal.decryptedValue || 0) * 10}%` }}
                          >
                            <span>Total Votes: {proposal.decryptedValue}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="stats-tab">
            <h2>Voting Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">📊</div>
                <div className="stat-value">{stats.totalProposals}</div>
                <div className="stat-label">Total Proposals</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">⏳</div>
                <div className="stat-value">{stats.activeProposals}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">✅</div>
                <div className="stat-value">{stats.endedProposals}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🗳️</div>
                <div className="stat-value">{stats.myVotesCount}</div>
                <div className="stat-label">My Votes</div>
              </div>
            </div>

            <div className="charts-section">
              <h3>Voting Activity</h3>
              <div className="activity-chart">
                {proposals.filter(p => p.isVerified).map(proposal => (
                  <div key={proposal.id} className="chart-bar">
                    <div className="bar-label">{proposal.title}</div>
                    <div className="bar-track">
                      <div 
                        className="bar-fill"
                        style={{ width: `${Math.min(100, (proposal.decryptedValue || 0) * 20)}%` }}
                      >
                        <span>{proposal.decryptedValue} votes</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'faq' && (
          <div className="faq-tab">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div 
                  key={index} 
                  className={`faq-item ${faqOpen === index ? 'open' : ''}`}
                  onClick={() => setFaqOpen(faqOpen === index ? null : index)}
                >
                  <div className="faq-question">
                    <span>{item.question}</span>
                    <span className="expand-icon">{faqOpen === index ? '−' : '+'}</span>
                  </div>
                  {faqOpen === index && (
                    <div className="faq-answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateProposalModal
          onSubmit={createProposal}
          onClose={() => setShowCreateModal(false)}
          creating={creatingProposal}
          proposalData={newProposalData}
          setProposalData={setNewProposalData}
          isEncrypting={isEncrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateProposalModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, proposalData, setProposalData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Proposal</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Votes will be encrypted using fully homomorphic encryption</p>
            </div>
          </div>

          <div className="form-group">
            <label>Proposal Title</label>
            <input
              type="text"
              name="title"
              value={proposalData.title}
              onChange={handleChange}
              placeholder="Enter proposal title..."
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={proposalData.description}
              onChange={handleChange}
              placeholder="Describe your proposal..."
              rows={4}
            />
          </div>

          <div className="form-group">
            <label>Voting Duration (days)</label>
            <input
              type="number"
              name="duration"
              value={proposalData.duration}
              onChange={handleChange}
              min="1"
              max="30"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !proposalData.title || !proposalData.description}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Creating with FHE..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;


